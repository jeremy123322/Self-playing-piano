import { useLocale } from "@/hooks/use-locale";
import { formatDateTime } from "@/lib/format";
import { COMMAND_STATUS_BADGE_CLASS, COMMAND_STATUS_LABEL_KEY, COMMAND_TYPE_LABEL_KEY } from "@/lib/diagnostics-labels";
import type { DiagnosticsCommand } from "@/lib/diagnostics-types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface CommandHistoryCardProps {
  commands: DiagnosticsCommand[];
}

export const CommandHistoryCard = ({ commands }: CommandHistoryCardProps) => {
  const { t } = useLocale();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("diagnostics.commands.title")}</CardTitle>
        <CardDescription>{t("diagnostics.commands.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {commands.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("diagnostics.commands.empty")}</p>
        ) : (
          <div className="flex flex-col gap-1">
            {commands.map((command) => (
              <div key={command.id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-muted/60">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{t(COMMAND_TYPE_LABEL_KEY[command.type])}</span>
                    <Badge variant="outline" className={COMMAND_STATUS_BADGE_CLASS[command.status]}>
                      {t(COMMAND_STATUS_LABEL_KEY[command.status])}
                    </Badge>
                    <span className="text-xs text-muted-foreground">rev. {command.revision}</span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatDateTime(command.createdAt)}
                    {command.errorMessage && <span className="text-destructive"> · {command.errorMessage}</span>}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
