"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { SongSummary } from "@spp/contracts";
import { useLocale } from "@/hooks/use-locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

interface EditSongDialogProps {
  song: SongSummary | undefined;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void> | void;
}

/**
 * Keyed by song id at the call site so this component remounts (and re-initializes its form
 * state) whenever a different song is opened for editing, instead of syncing props via an effect.
 */
export const EditSongDialog = ({ song, onOpenChange, onSaved }: EditSongDialogProps) => {
  const [title, setTitle] = useState(song?.title ?? "");
  const [artist, setArtist] = useState(song?.artist ?? "");
  const [saving, setSaving] = useState(false);
  const { t } = useLocale();

  const save = async () => {
    if (!song) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      toast.error(t("toast.titleRequired"));
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/songs/${song.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: trimmedTitle, artist: artist.trim() || null }),
      });
      if (!response.ok) throw new Error(t("toast.saveFailed"));
      toast.success(t("toast.songUpdated"));
      onOpenChange(false);
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("toast.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(song)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("editSong.title")}</DialogTitle>
          <DialogDescription>{t("editSong.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="edit-title">{t("editSong.titleLabel")}</Label>
            <Input id="edit-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-artist">{t("editSong.artistLabel")}</Label>
            <Input id="edit-artist" value={artist} onChange={(event) => setArtist(event.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("editSong.cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {t("editSong.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
