"use client";

import { useRef, useState } from "react";
import { CheckCircle2Icon, CircleXIcon, Loader2Icon, UploadCloudIcon } from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: () => Promise<void> | void;
}

type UploadStatus = "waiting" | "uploading" | "complete" | "error";
interface UploadEntry {
  file: File;
  status: UploadStatus;
  message?: string | undefined;
}

const MIDI_FILE_PATTERN = /\.midi?$/i;
const titleFromFileName = (fileName: string) => fileName.replace(MIDI_FILE_PATTERN, "");

const uploadOneFile = async (file: File, title?: string, artist?: string): Promise<{ ok: boolean; message?: string }> => {
  const formData = new FormData();
  formData.set("file", file);
  if (title) formData.set("title", title);
  if (artist) formData.set("artist", artist);
  const response = await fetch("/api/admin/songs", { method: "POST", body: formData });
  const payload = (await response.json()) as { error?: string };
  return response.ok ? { ok: true } : { ok: false, message: payload.error ?? "Upload failed" };
};

const StatusIcon = ({ status }: { status: UploadStatus }) => {
  if (status === "complete") return <CheckCircle2Icon className="size-4 text-success" />;
  if (status === "error") return <CircleXIcon className="size-4 text-destructive" />;
  if (status === "uploading") return <Loader2Icon className="size-4 animate-spin text-info" />;
  return <span className="size-4" />;
};

export const UploadDialog = ({ open, onOpenChange, onUploaded }: UploadDialogProps) => {
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t, tCount } = useLocale();

  const isSingleFile = pendingFiles.length === 1;

  const resetSelection = () => {
    setPendingFiles([]);
    setTitle("");
    setArtist("");
  };

  const selectFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const midiFiles = Array.from(files).filter((file) => MIDI_FILE_PATTERN.test(file.name));
    if (midiFiles.length === 0) {
      toast.error(t("toast.onlyMidiAccepted"));
      return;
    }
    setPendingFiles(midiFiles);
    setUploads([]);
    if (midiFiles.length === 1 && midiFiles[0]) setTitle(titleFromFileName(midiFiles[0].name));
  };

  const runUpload = async () => {
    setUploading(true);
    setUploads(pendingFiles.map((file) => ({ file, status: "waiting" as const })));
    const totalFiles = pendingFiles.length;
    let successCount = 0;
    for (const file of pendingFiles) {
      setUploads((current) => current.map((entry) => (entry.file === file ? { ...entry, status: "uploading" } : entry)));
      const result = await uploadOneFile(file, isSingleFile ? title : undefined, isSingleFile ? artist : undefined);
      successCount += result.ok ? 1 : 0;
      setUploads((current) =>
        current.map((entry) =>
          entry.file === file ? { ...entry, status: result.ok ? "complete" : "error", message: result.message } : entry,
        ),
      );
    }
    setUploading(false);
    setPendingFiles([]);
    if (successCount > 0) {
      toast.success(tCount("toast.uploaded", successCount));
      await onUploaded();
    }
    if (successCount < totalFiles) toast.error(t("toast.uploadPartialFail"));
  };

  const closeDialog = () => {
    onOpenChange(false);
    resetSelection();
    setUploads([]);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(next) : closeDialog())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("upload.title")}</DialogTitle>
          <DialogDescription>{t("upload.description")}</DialogDescription>
        </DialogHeader>

        {uploads.length === 0 && (
          <div
            className={cn(
              "flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border px-6 py-8 text-center transition-colors",
              dragActive && "border-primary bg-primary/5",
            )}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              selectFiles(event.dataTransfer.files);
            }}
          >
            <UploadCloudIcon className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t("upload.dragHint")}</p>
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              {t("upload.browse")}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".mid,.midi,audio/midi,audio/x-midi"
              multiple
              className="hidden"
              onChange={(event) => selectFiles(event.target.files)}
            />
          </div>
        )}

        {pendingFiles.length > 0 && uploads.length === 0 && isSingleFile && (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="upload-title">{t("upload.titleLabel")}</Label>
              <Input id="upload-title" value={title} onChange={(event) => setTitle(event.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="upload-artist">{t("upload.artistLabel")}</Label>
              <Input id="upload-artist" value={artist} onChange={(event) => setArtist(event.target.value)} />
            </div>
          </div>
        )}

        {pendingFiles.length > 1 && uploads.length === 0 && (
          <ul className="max-h-40 overflow-y-auto rounded-md border border-border">
            {pendingFiles.map((file) => (
              <li key={file.name} className="truncate px-3 py-1.5 text-sm">
                {file.name}
              </li>
            ))}
          </ul>
        )}

        {uploads.length > 0 && (
          <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
            {uploads.map((entry) => (
              <li key={entry.file.name} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
                <StatusIcon status={entry.status} />
                <span className="min-w-0 flex-1 truncate">{entry.file.name}</span>
                {entry.message && <span className="text-xs text-destructive">{entry.message}</span>}
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          {pendingFiles.length > 0 && uploads.length === 0 && (
            <>
              <Button variant="outline" onClick={resetSelection}>
                {t("upload.cancel")}
              </Button>
              <Button onClick={() => void runUpload()} disabled={uploading}>
                {pendingFiles.length > 1 ? t("upload.uploadMany", { count: pendingFiles.length }) : t("upload.uploadOne")}
              </Button>
            </>
          )}
          {uploads.length > 0 && (
            <Button onClick={closeDialog} disabled={uploading}>
              {t("upload.done")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
