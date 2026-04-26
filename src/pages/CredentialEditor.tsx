import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CredentialForm } from "@/components/CredentialForm";

export function CredentialEditor() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new" || !id;
  const credentialId = isNew ? undefined : id;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-[var(--border)] px-6 py-4">
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} />
        </Button>
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">
          {isNew ? t("credentials.newCredential") : t("credentials.editCredential")}
        </h1>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-4 px-6 py-6">
          <CredentialForm
            credentialId={credentialId}
            onCancel={() => navigate(-1)}
            onSaved={() => navigate("/credentials")}
          />
        </div>
      </div>
    </div>
  );
}
