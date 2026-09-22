package middlewares

import "github.com/labstack/echo/v4"

// CrossOriginIsolation adds the headers that make a document cross-origin
// isolated, which is what exposes SharedArrayBuffer and Atomics. The BoxedWine
// plugin's multithreaded WebAssembly build needs both to create its shared
// memory.
//
// COEP is "credentialless" rather than "require-corp": cross-origin
// subresources without a Cross-Origin-Resource-Policy header (for example the
// document viewer script loaded from unpkg) are still fetched, just without
// credentials. Browsers that do not implement credentialless stay
// non-isolated, and the plugin falls back to its single threaded build.
func CrossOriginIsolation() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			header := c.Response().Header()
			header.Set("Cross-Origin-Opener-Policy", "same-origin")
			header.Set("Cross-Origin-Embedder-Policy", "credentialless")
			return next(c)
		}
	}
}
