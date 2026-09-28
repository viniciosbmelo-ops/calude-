import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { XCircle } from "lucide-react";
import { useLanguage } from "@/lib/i18n";
import { publicPageMessages } from "@/locales/public-pages";
import { PublicLanguageSelector } from "@/components/public-language-selector";

export default function AssinaturaCancelada() {
  const { locale } = useLanguage();
  const copy = publicPageMessages[locale];
  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative" style={{ background: "#f0f4f8" }}>
      <div className="absolute right-4 top-4"><PublicLanguageSelector /></div>
      <Card className="w-full max-w-md shadow-lg border-border/60 bg-white text-center">
        <CardHeader className="space-y-3 pb-4">
          <div className="flex justify-center mb-2">
            <img
              src={`${import.meta.env.BASE_URL}logo-docsholder.png?v=2`}
              alt="DocSholder"
              className="h-12 w-auto object-contain"
            />
          </div>
          <div className="flex justify-center">
            <XCircle className="h-16 w-16" style={{ color: "#dc2626" }} />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight" style={{ color: "#1A365D" }}>
            {copy.paymentCancelled}
          </CardTitle>
          <CardDescription className="text-base">
            {copy.paymentCancelledDescription}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Link href="/dashboard">
            <Button className="w-full" size="lg">
              {copy.goToAccount}
            </Button>
          </Link>
          <Link href="/login">
            <Button variant="outline" className="w-full">
              {copy.backToLogin}
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
