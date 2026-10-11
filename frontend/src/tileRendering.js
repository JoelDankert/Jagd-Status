// WebView composites Leaflet's individually translated tile images with visible
// fractional-pixel seams. 2D positioning keeps their edges pixel-aligned without
// stretching satellite imagery. Keep normal browsers on the accelerated path.
export function configureMapRendering(leaflet, userAgent) {
  if (/\bAndroid\b/i.test(userAgent) && /(?:;|\()\s*wv(?:;|\))/i.test(userAgent)) {
    leaflet.Browser.any3d = false;
  }
}
