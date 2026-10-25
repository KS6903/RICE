import api from "../services/api";

/** Where an uploaded picture (such as a plan's payment QR code) is read from.
 *  Built from the API's own base, so the desktop app reaches it too. */
export function mediaUrl(key: string): string {
  return api.getUri({ url: `/media/${key}` });
}
