package routes

import (
	"github.com/labstack/echo/v4"

	"file-lite-go/apierr"
)

// withAPIErrorHandler installs the production error handler on a test echo.
//
// Handlers return *apierr.Error values; without this the default Echo handler
// would treat them as opaque errors and answer 500, so every test that checks a
// status code or an error body has to go through it.
func withAPIErrorHandler(e *echo.Echo) *echo.Echo {
	e.HTTPErrorHandler = apierr.Handler
	return e
}
