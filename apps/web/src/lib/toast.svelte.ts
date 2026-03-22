export type ToastType = "success" | "error" | "warning";

export interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

let toasts = $state<Toast[]>([]);
let nextId = 0;

export function getToasts(): Toast[] {
  return toasts;
}

export function addToast(type: ToastType, message: string, duration = 4000) {
  const id = nextId++;
  toasts = [...toasts, { id, type, message }];
  setTimeout(() => removeToast(id), duration);
}

export function removeToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
}

export function toastSuccess(message: string) {
  addToast("success", message);
}

export function toastError(message: string) {
  addToast("error", message, 6000);
}

export function toastWarning(message: string) {
  addToast("warning", message, 5000);
}
