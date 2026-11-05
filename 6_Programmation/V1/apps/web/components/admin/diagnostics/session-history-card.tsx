import { useLocale } from "@/hooks/use-locale";
import { formatDateTime } from "@/lib/format";
import { SESSION_STATE_BADGE_CLASS, SESSION_STATE_LABEL_KEY } from "@/lib/diagnostics-labels";
import type { DiagnosticsSession } from "@/lib/diagnostics-types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface SessionHistoryCardProps {
  sessions: DiagnosticsSession[];
}

export const SessionHistoryCard = ({ sessions }: SessionHistoryCardProps) => {
  const { t } = useLocale();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("diagnostics.sessions.title")}</CardTitle>
        <CardDescription>{t("diagnostics.sessions.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {sessions.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("diagnostics.sessions.empty")}</p>
        ) : (
          <div className="flex flex-col gap-1">
            {sessions.map((session) => (
              <div key={session.id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-muted/60">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{session.songTitle ?? t("diagnostics.sessions.unknownSong")}</span>
                    <Badge variant="outline" className={SESSION_STATE_BADGE_CLASS[session.state]}>
                      {t(SESSION_STATE_LABEL_KEY[session.state])}
                    </Badge>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatDateTime(session.requestedAt)}
                    {session.errorMessage && <span className="text-destructive"> · {session.errorMessage}</span>}
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
