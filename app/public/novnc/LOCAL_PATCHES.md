# Local noVNC changes

The original license remains in LICENSE.txt. core/rfb.js adds a public
resizeLimits setter (640..1600 x 480..1000), 300ms resize debounce when enabled,
and a firstframe event after the first completed display flush. Existing callers
without resizeLimits retain upstream resizing behavior. No private methods are
replaced at runtime. Client-side limits are not the security boundary: the
server-side browser relay must enforce its own size, screen and rate limits.

core/util/desktop-size.mjs exports boundedDesktopSize; initial and subsequent
sizes use the same aspect-preserving fit within the maximum, with a 640x480
minimum. Tiny viewports scale the remote desktop; large viewports do not grow
the server framebuffer beyond the relay's limit.
