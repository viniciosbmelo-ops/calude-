import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2 } from "lucide-react";
import { useLanguage } from "@/lib/i18n";
import { publicPageMessages } from "@/locales/public-pages";
import { PublicLanguageSelector } from "@/components/public-language-selector";

export default function Sucesso() {
  const { locale } = useLanguage();
  const copy = publicPageMessages[locale];
  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative" style={{ background: "#f0f4f8" }}>
      <div className="absolute right-4 top-4"><PublicLanguageSelector /></div>
      <Card className="w-full max-w-md shadow-lg border-border/60 bg-white text-center">
        <CardHeader className="space-y-3 pb-4">
          <div className="flex justify-center mb-2">
            <img
              src={`${import.meta.env.BASE_URL}logo-docknee-final.png?v=2`}
              alt="DocKnee"
              className="h-12 w-auto object-contain"
            />
          </div>
          <div className="flex justify-center">
            <CheckCircle2 className="h-16 w-16" style={{ color: "#16a34a" }} />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight" style={{ color: "#1A365D" }}>
            {copy.subscriptionConfirmed}
          </CardTitle>
          <CardDescription className="text-base">
            {copy.subscriptionConfirmedDescription}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {copy.trialEnjoy}
          </p>
          <Link href="/dashboard">
            <Button className="w-full" size="lg">
              {copy.accessPlatform}
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
