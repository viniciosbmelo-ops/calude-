import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { Link } from "wouter";
import { useLanguage } from "@/lib/i18n";
import { publicPageMessages } from "@/locales/public-pages";
import { PublicLanguageSelector } from "@/components/public-language-selector";

export default function NotFound() {
  const { locale } = useLanguage();
  const copy = publicPageMessages[locale];
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50 relative">
      <div className="absolute right-4 top-4"><PublicLanguageSelector /></div>
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <h1 className="text-2xl font-bold text-gray-900">{copy.notFoundTitle}</h1>
          </div>

          <p className="mt-4 text-sm text-gray-600">
            {copy.notFoundDescription}
          </p>
          <Link href="/" className="mt-5 inline-block text-sm font-medium text-primary hover:underline" data-testid="link-home">
            {copy.goHome}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
