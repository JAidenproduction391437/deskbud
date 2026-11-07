const { desktopCapturer, screen } = require('electron');

/** Fits a screen into a long edge, without ever enlarging it. */
function fit(width, height, longEdge) {
  const scale = Math.min(1, longEdge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Takes a picture of the main screen, as JPEG at the given quality, or as PNG if quality is 'png'.
 * Returns { base64, width, height, bounds }, where bounds is the screen in app coordinates.
 */
async function captureScreen(longEdge = 1280, quality = 80, region = null) {
  const display = screen.getPrimaryDisplay();
  const { bounds, scaleFactor } = display;
  const size = region
    ? { width: Math.round(bounds.width * scaleFactor), height: Math.round(bounds.height * scaleFactor) }
    : fit(bounds.width, bounds.height, longEdge);

  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error('Could not capture the screen. On a Mac, allow Screen Recording for Desk Bud.');
  }

  let image = source.thumbnail;
  if (region) {
    image = image.crop(region(image.getSize()));
    const cropped = image.getSize();
    const target = fit(cropped.width, cropped.height, longEdge);
    image = image.resize(target);
  }

  const { width, height } = image.getSize();
  const encoded = quality === 'png' ? image.toPNG() : image.toJPEG(quality);
  return { base64: encoded.toString('base64'), width, height, bounds };
}

module.exports = { captureScreen };
