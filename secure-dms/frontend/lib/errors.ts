import { ApiClientError } from "@/lib/api";

export function caseErrorMessage(caught: unknown, fallback: string): string {
  if (!(caught instanceof ApiClientError)) {
    return fallback;
  }
  if (caught.status === 401) {
    return "Your session has ended. Sign in again.";
  }
  if (caught.status === 403) {
    if (caught.message && !caught.message.toLowerCase().includes("not authorized to perform this action")) {
      return caught.message;
    }
    return "You do not have permission to access this case.";
  }
  if (caught.status === 404) {
    return caught.message || "Case not found.";
  }
  if (caught.status === 422 || caught.status === 409) {
    return caught.message;
  }
  if (caught.status === 0 || caught.status >= 500) {
    return "The case service could not complete this request.";
  }
  return caught.message || fallback;
}
