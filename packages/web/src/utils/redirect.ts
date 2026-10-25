/** Leave the app for another site, such as a payment provider's checkout page.
 *  Its own module so tests can stand in for it (jsdom can't navigate). */
export function redirectTo(url: string): void {
  window.location.assign(url);
}
