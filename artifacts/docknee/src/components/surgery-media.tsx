import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  ExternalLink,
  Image,
  Loader2,
  Play,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useScopedTranslations } from "@/lib/i18n";
import { surgeryMediaMessages } from "@/locales/surgery-routes";

type SurgeryMediaTranslator = (
  key: keyof typeof surgeryMediaMessages["pt-BR"],
  params?: Record<string, string | number>,
) => string;

interface MediaItem {
  id: number;
  surgeryId: number;
  mediaType: "photo" | "video";
  fileName: string;
  mimeType: string;
  originalPath: string;
  previewPath: string | null;
  previewSignedUrl: string | null;
  downloadSignedUrl: string | null;
  previewStatus: "pending" | "ready" | "error";
  durationSeconds: number | null;
  createdAt: string;
}

interface UploadingItem {
  tempId: string;
  fileName: string;
  mediaType: "photo" | "video";
  progress: number;
  stage: "uploading" | "processing";
}

interface SurgeryMediaProps {
  surgeryId?: number;
  ensureSurgeryId?: () => Promise<number>;
}

async function apiFetch(path: string, fallbackError: string, opts?: RequestInit) {
  const res = await fetch(path, {
    ...opts,
    credentials: "same-origin",
    headers: { ...(opts?.headers || {}) },
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? fallbackError);
  }
  return res.json();
}

export function SurgeryMedia({ surgeryId, ensureSurgeryId }: SurgeryMediaProps) {
  const t = useScopedTranslations(surgeryMediaMessages);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [uploading, setUploading] = useState<UploadingItem[]>([]);
  const [loading, setLoading] = useState(Boolean(surgeryId));
  const [resolvingSurgeryId, setResolvingSurgeryId] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const pollingRef = useRef<Record<number, ReturnType<typeof setInterval>>>({});

  const fetchItems = useCallback(async () => {
    if (!surgeryId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
       const data = await apiFetch(`/api/media/surgery/${surgeryId}`, t("requestFailed")) as MediaItem[];
      setItems((currentItems) => {
        const serverIds = new Set(data.map((item) => item.id));
        const optimisticItems = currentItems.filter(
          (item) => item.surgeryId === surgeryId && !serverIds.has(item.id),
        );
        return [...data, ...optimisticItems];
      });
    } catch {
    } finally {
      setLoading(false);
    }
  }, [surgeryId, t]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const startPolling = (id: number) => {
    if (pollingRef.current[id]) return;
    pollingRef.current[id] = setInterval(async () => {
      try {
         const item: MediaItem = await apiFetch(`/api/media/status/${id}`, t("requestFailed"));
        if (item.previewStatus !== "pending") {
          clearInterval(pollingRef.current[id]);
          delete pollingRef.current[id];
          setItems((prev) => prev.map((i) => (i.id === id ? item : i)));
        }
      } catch {}
    }, 3000);
  };

  useEffect(() => {
    items.filter((i) => i.previewStatus === "pending").forEach((i) => startPolling(i.id));
    return () => {
      Object.values(pollingRef.current).forEach(clearInterval);
      pollingRef.current = {};
    };
  }, [items]);

  // Detect media type using both MIME type and file extension as fallback
  const detectMediaType = (file: File): { mediaType: "photo" | "video"; mimeType: string } | null => {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const videoExts = ["mp4", "mov", "avi", "mkv", "webm", "m4v", "3gp", "hevc", "ts", "mts"];
    const imageExts = ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp", "tiff", "tif"];

    const mimeIsVideo = file.type.startsWith("video/");
    const mimeIsPhoto = file.type.startsWith("image/");
    const extIsVideo = videoExts.includes(ext);
    const extIsPhoto = imageExts.includes(ext);

    if (mimeIsVideo || extIsVideo) {
      // Use a standard MIME if the browser didn't provide one
      const mimeType = file.type || (ext === "mov" ? "video/quicktime" : "video/mp4");
      return { mediaType: "video", mimeType };
    }
    if (mimeIsPhoto || extIsPhoto) {
      const mimeType = file.type || "image/jpeg";
      return { mediaType: "photo", mimeType };
    }
    return null;
  };

  const uploadSingleFile = async (file: File, activeSurgeryId: number) => {
    const detected = detectMediaType(file);
    if (!detected) {
       toast({ title: t("invalidFormat"), description: t("invalidFormatDescription", { file: file.name }), variant: "destructive" });
      return;
    }
    const { mediaType, mimeType } = detected;
    const tempId = Math.random().toString(36).slice(2);

    setUploading((prev) => [...prev, { tempId, fileName: file.name, mediaType, progress: 0, stage: "uploading" }]);

    try {
       const { uploadURL, token } = await apiFetch("/api/media/request-upload-url", t("uploadError"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ surgeryId: activeSurgeryId, name: file.name, contentType: mimeType, size: file.size }),
      });

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadURL);
        xhr.setRequestHeader("Content-Type", mimeType);
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) {
            const pct = Math.round((ev.loaded / ev.total) * 100);
            setUploading((prev) => prev.map((u) => u.tempId === tempId ? { ...u, progress: pct } : u));
          }
        };
        xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`)));
        xhr.onerror = () => reject(new Error("Network error"));
        xhr.send(file);
      });

      setUploading((prev) => prev.map((u) => u.tempId === tempId ? { ...u, stage: "processing", progress: 100 } : u));

       const record: { id: number; originalPath: string } = await apiFetch("/api/media/process", t("uploadError"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      setUploading((prev) => prev.filter((u) => u.tempId !== tempId));
      const newItem: MediaItem = {
        id: record.id, surgeryId: activeSurgeryId, mediaType, fileName: file.name, mimeType,
        originalPath: record.originalPath, previewPath: null, previewSignedUrl: null,
        downloadSignedUrl: null, previewStatus: "pending", durationSeconds: null,
        createdAt: new Date().toISOString(),
      };
      setItems((prev) => [...prev, newItem]);
      startPolling(record.id);
    } catch (error) {
      setUploading((prev) => prev.filter((u) => u.tempId !== tempId));
      toast({
        title: t("uploadError"),
        description: error instanceof Error
          ? error.message
          : t("uploadErrorDescription", { file: file.name }),
        variant: "destructive",
      });
    }
  };

  const resolveActiveSurgeryId = async (): Promise<number | null> => {
    if (surgeryId) return surgeryId;
    if (!ensureSurgeryId) {
      toast({
         title: t("prepareError"),
         description: t("saveBeforeMedia"),
        variant: "destructive",
      });
      return null;
    }

    setResolvingSurgeryId(true);
    try {
      return await ensureSurgeryId();
    } catch (error) {
      toast({
         title: t("prepareError"),
         description: error instanceof Error ? error.message : t("retryBeforeUpload"),
        variant: "destructive",
      });
      return null;
    } finally {
      setResolvingSurgeryId(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    e.target.value = "";

    const activeSurgeryId = await resolveActiveSurgeryId();
    if (!activeSurgeryId) return;

    // Upload all files in parallel
    await Promise.all(files.map((file) => uploadSingleFile(file, activeSurgeryId)));
  };

  const handleDelete = async (item: MediaItem) => {
     if (!confirm(t("deleteConfirm", { file: item.fileName }))) return;
    try {
       await apiFetch(`/api/media/${item.id}`, t("deleteError"), { method: "DELETE" });
      setItems((prev) => prev.filter((i) => i.id !== item.id));
       toast({ title: t("deleted") });
    } catch {
       toast({ title: t("deleteError"), variant: "destructive" });
    }
  };

  const handleOpen = (item: MediaItem) => {
    const url = item.downloadSignedUrl;
     if (!url) { toast({ title: t("unavailable"), variant: "destructive" }); return; }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const previewSrc = (item: MediaItem) => {
    return item.previewSignedUrl ?? null;
  };

  const isEmpty = items.length === 0 && uploading.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
         <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">{t("title")}</h3>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={resolvingSurgeryId}
            className="gap-1.5 text-xs px-2.5"
          >
            {resolvingSurgeryId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
             <span>{resolvingSurgeryId ? t("preparing") : t("addMedia")}</span>
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,video/quicktime,.mov,.mp4,.m4v,.heic,.heif"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : isEmpty ? (
        <div
          className={cn(
            "border-2 border-dashed border-border rounded-xl py-10 flex flex-col items-center gap-2 text-muted-foreground transition-all",
            resolvingSurgeryId ? "cursor-wait opacity-70" : "cursor-pointer hover:border-primary/40 hover:bg-primary/5",
          )}
          onClick={() => {
            if (!resolvingSurgeryId) fileInputRef.current?.click();
          }}
        >
          <div className="flex gap-3">
            {resolvingSurgeryId ? (
              <Loader2 className="h-7 w-7 animate-spin opacity-50" />
            ) : (
              <>
                <Image className="h-7 w-7 opacity-40" />
                <Video className="h-7 w-7 opacity-40" />
              </>
            )}
          </div>
          <p className="text-sm font-medium">
             {resolvingSurgeryId ? t("creatingDraft") : t("addSurgeryMedia")}
          </p>
           {!resolvingSurgeryId && <p className="text-xs opacity-60">{t("selectHelp")}</p>}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {items.map((item) => (
            <MediaCard
              key={item.id}
               item={item}
               t={t}
              previewSrc={previewSrc(item)}
              onDelete={handleDelete}
              onOpen={() => handleOpen(item)}
            />
          ))}
          {uploading.map((u) => (
             <UploadCard key={u.tempId} item={u} t={t} />
          ))}
          <div
            className="aspect-square rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-1 text-muted-foreground cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-all text-xs"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-5 w-5 opacity-50" />
             <span className="opacity-60">{t("add")}</span>
          </div>
        </div>
      )}

    </div>
  );
}

function MediaCard({
  item, previewSrc, onDelete, onOpen, t,
}: {
  item: MediaItem;
  previewSrc: string | null;
  onDelete: (item: MediaItem) => void;
  onOpen: () => void;
  t: SurgeryMediaTranslator;
}) {
  const isPending = item.previewStatus === "pending";
  const isError = item.previewStatus === "error";
  const isVideo = item.mediaType === "video";

  return (
    <div
      className="relative group aspect-square rounded-xl overflow-hidden bg-muted border border-border cursor-pointer"
      onClick={!isPending && !isError ? onOpen : undefined}
    >
      {isPending ? (
        <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
           <span className="text-[10px]">{t("processing")}</span>
        </div>
      ) : isError ? (
        <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-destructive">
          <X className="h-5 w-5" />
           <span className="text-[10px]">{t("error")}</span>
        </div>
      ) : isVideo ? (
        <video
          src={previewSrc || undefined}
          className="w-full h-full object-cover"
          preload="metadata"
          playsInline
        />
      ) : (
        <img
          src={previewSrc || undefined}
          alt={item.fileName}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      )}

      {isVideo && !isPending && !isError && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-black/50 rounded-full p-2">
            <Play className="h-5 w-5 text-white fill-white" />
          </div>
        </div>
      )}

      {/* Desktop hover overlay — open + delete */}
      {!isPending && (
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-end justify-between p-2 opacity-0 group-hover:opacity-100 hidden md:flex">
          {!isError && (
            <div className="bg-white/90 rounded-lg p-1.5 text-foreground">
              <ExternalLink className="h-3.5 w-3.5" />
            </div>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(item); }}
            className="bg-white/90 rounded-lg p-1.5 text-destructive hover:bg-white transition-colors ml-auto"
             title={t("delete")}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Mobile: always-visible delete button at top-right */}
      {!isPending && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(item); }}
          className="md:hidden absolute top-1.5 right-1.5 bg-black/60 rounded-full p-1.5 text-white active:bg-red-600 transition-colors"
           title={t("delete")}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}

      <div className="absolute top-1.5 left-1.5">
        <span className={cn("rounded-md px-1.5 py-0.5 text-[9px] font-semibold text-white", isVideo ? "bg-purple-600/80" : "bg-primary/80")}>
           {isVideo ? t("videoShort") : t("photoShort")}
        </span>
      </div>
    </div>
  );
}

function UploadCard({ item, t }: { item: UploadingItem; t: SurgeryMediaTranslator }) {
  return (
    <div className="aspect-square rounded-xl border-2 border-primary/30 bg-primary/5 flex flex-col items-center justify-center gap-2 text-primary p-3">
      <Loader2 className="h-6 w-6 animate-spin" />
      <p className="text-[10px] text-center font-medium leading-tight break-all line-clamp-2">{item.fileName}</p>
      {item.stage === "uploading" ? (
        <div className="w-full bg-primary/20 rounded-full h-1">
          <div
            className="bg-primary h-1 rounded-full transition-all"
            style={{ width: `${item.progress}%` }}
          />
        </div>
      ) : (
         <p className="text-[9px] opacity-60">{t("compressing")}</p>
      )}
    </div>
  );
}

