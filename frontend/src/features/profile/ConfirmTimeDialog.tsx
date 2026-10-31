import { Alert, Button, Dialog } from "../../components/ui";

export function ConfirmTimeDialog({
  title,
  detail,
  error,
  loading,
  onConfirm,
  onCancel,
}: {
  title: string;
  detail: string;
  error?: string | null;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open
      title={title}
      description={detail}
      locked={loading}
      onClose={onCancel}
      footer={
        <>
          <Button type="button" variant="secondary" className="w-full sm:flex-1" disabled={loading} onClick={onCancel}>
            Keep current time
          </Button>
          <Button type="button" className="w-full sm:flex-1" loading={loading} disabled={loading} onClick={onConfirm}>
            Confirm new time
          </Button>
        </>
      }
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </Dialog>
  );
}
