import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge, Button, Card, CardBody, CardHeader } from "@/components/ui";
import { getClaudeStatus, type ClaudeStatus } from "@/lib/claudeChat";

export const MCP_ADD_COMMAND = "claude mcp add vibe-crypto -- vibe-crypto-mcp";
export const CLAUDE_GUIDE_URL = "https://github.com/buckleson/vibe-trading-crypto/blob/main/docs/vibe-crypto/CLAUDE_CODE.md";

export function ClaudeSettings() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ClaudeStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    getClaudeStatus()
      .then((value) => { if (alive) setStatus(value); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  const loading = !status && !failed;
  const unavailable = failed || (status !== null && !status.available);
  const needsLogin = !unavailable && status !== null && status.auth === "unknown";

  const badge = loading
    ? null
    : unavailable
      ? <Badge tone="danger">{t("settings.claudeUnavailable", { defaultValue: "Unavailable" })}</Badge>
      : needsLogin
        ? <Badge tone="warning">{t("settings.claudeNeedsLogin", { defaultValue: "Needs login" })}</Badge>
        : <Badge tone="success">{t("settings.claudeConnected", { defaultValue: "Connected" })}</Badge>;

  const detail = status?.auth === "api_key"
    ? t("settings.claudeUsingApiKey", { defaultValue: "Using API key" })
    : status?.auth === "claude_login"
      ? t("settings.claudeUsingLogin", { defaultValue: "Using your Claude login" })
      : t("settings.claudeSetupHint", { defaultValue: "Set ANTHROPIC_API_KEY or log in with the claude command" });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(MCP_ADD_COMMAND);
      setCopied(true);
      toast.success(t("settings.claudeCommandCopied", { defaultValue: "Command copied" }));
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("settings.claudeCopyFailed", { defaultValue: "Could not copy the command" }));
    }
  };

  const openChat = () => {
    window.dispatchEvent(new CustomEvent("vc:open-dock", { detail: { tab: "chat" } }));
  };

  return (
    <Card>
      <CardHeader
        title={t("settings.claudeTitle", { defaultValue: "Claude" })}
        description={t("settings.claudeDesc", { defaultValue: "Chat with Claude about your strategies, backtests and paper trades." })}
      />
      <CardBody className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {badge}
            <span className="text-[13px] text-muted-foreground">{loading ? t("settings.loading") : detail}</span>
          </div>
          <Button variant="secondary" size="sm" onClick={openChat}>
            <MessageSquare className="h-4 w-4" aria-hidden="true" />
            {t("settings.claudeOpenChat", { defaultValue: "Open chat" })}
          </Button>
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          <h3 className="text-sm font-medium">
            {t("settings.claudeTerminalTitle", { defaultValue: "Use Claude Code in your terminal" })}
          </h3>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-border bg-muted px-3 py-2 font-mono text-[13px]">
              {MCP_ADD_COMMAND}
            </code>
            <Button variant="secondary" size="sm" onClick={() => void copy()}>
              {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
              {t("settings.claudeCopy", { defaultValue: "Copy" })}
            </Button>
          </div>
          <p className="text-[13px] text-muted-foreground">
            {t("settings.claudeInstallAlt", { defaultValue: "Or run vibe-crypto mcp install" })}
          </p>
          <a
            href={CLAUDE_GUIDE_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline"
          >
            {t("settings.claudeGuide", { defaultValue: "Setup guide" })}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>
      </CardBody>
    </Card>
  );
}
