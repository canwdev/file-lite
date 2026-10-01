// Package apierr defines the single error shape every HTTP endpoint returns.
//
// The shape is documented in docs/design/api.md §12:
//
//	{ "code": "path_not_found", "message": "Path not found", "details": { … } }
//
// `code` is what clients branch on; `message` is what they show to the user.
// Handlers return an *Error (Echo renders it through Handler), or call Write when
// they must keep the status code available after writing (the login guard reads it).
package apierr

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/labstack/echo/v4"

	"file-lite-go/utils"
)

// Error codes. These are part of the API contract; adding one means updating
// docs/design/api.md in the same commit.
const (
	CodeBadRequest          = "bad_request"
	CodeInvalidPath         = "invalid_path"
	CodeInvalidName         = "invalid_name"
	CodeUnsupportedTaskKind = "unsupported_task_kind"
	CodeOutOfScope          = "out_of_scope"
	CodePayloadTooLarge     = "payload_too_large"
	CodeTooManyPaths        = "too_many_paths"
	CodeUnauthorized        = "unauthorized"
	CodeForbidden           = "forbidden"
	CodeOutsideAllowedRoots = "outside_allowed_roots"
	CodeNotFound            = "not_found"
	CodePathNotFound        = "path_not_found"
	CodeTaskNotFound        = "task_not_found"
	CodeMeasurementNotFound = "measurement_not_found"
	CodeMethodNotAllowed    = "method_not_allowed"
	CodeConflict            = "conflict"
	CodeTaskFinished        = "task_finished"
	CodePreconditionFailed  = "precondition_failed"
	CodeUnsupportedMedia    = "unsupported_media"
	CodeMediaTooLarge       = "media_too_large"
	CodeBitLockerLocked     = "bitlocker_locked"
	CodeTooManyRequests     = "too_many_requests"
	CodeFeatureUnavailable  = "feature_unavailable"
	CodeServerBusy          = "server_busy"
	CodeNetworkUnreachable  = "network_unreachable"
	CodeNetworkAccessFailed = "network_access_failed"
	CodeIOError             = "io_error"
	CodeSettingsFailed      = "settings_failed"
	CodeInternal            = "internal_error"
)

// Error is an HTTP error with a machine-readable code.
type Error struct {
	Status  int
	Code    string
	Message string
	Details any
	// RetryAfter, when greater than zero, is sent as the Retry-After header.
	RetryAfter int
}

func (e *Error) Error() string { return e.Message }

// New builds an error. Most call sites use a constructor below.
func New(status int, code, message string) *Error {
	return &Error{Status: status, Code: code, Message: message}
}

// WithDetails attaches structured details to the response body.
func (e *Error) WithDetails(details any) *Error {
	e.Details = details
	return e
}

// WithMessage replaces the user-facing sentence, keeping the status and code.
func (e *Error) WithMessage(message string) *Error {
	e.Message = message
	return e
}

// WithRetryAfter adds a Retry-After header (seconds).
func (e *Error) WithRetryAfter(seconds int) *Error {
	e.RetryAfter = seconds
	return e
}

func BadRequest(code, message string) *Error {
	return New(http.StatusBadRequest, code, message)
}

func Unauthorized(message string) *Error {
	return New(http.StatusUnauthorized, CodeUnauthorized, message)
}

func Forbidden(code, message string) *Error {
	return New(http.StatusForbidden, code, message)
}

func NotFound(code, message string) *Error {
	return New(http.StatusNotFound, code, message)
}

func Conflict(code, message string) *Error {
	return New(http.StatusConflict, code, message)
}

func PreconditionFailed(message string) *Error {
	return New(http.StatusPreconditionFailed, CodePreconditionFailed, message)
}

func PayloadTooLarge(message string) *Error {
	return New(http.StatusRequestEntityTooLarge, CodePayloadTooLarge, message)
}

func ServiceUnavailable(code, message string) *Error {
	return New(http.StatusServiceUnavailable, code, message)
}

func Internal(code, message string) *Error {
	return New(http.StatusInternalServerError, code, message)
}

func TooManyRequests(message string) *Error {
	return New(http.StatusTooManyRequests, CodeTooManyRequests, message)
}

// Payload is the JSON body of every error response.
type Payload struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details any    `json:"details,omitempty"`
}

// Write renders e and returns nil, so a handler can `return apierr.Write(c, e)`
// when it wants the status code to stay observable by later middleware.
func Write(c echo.Context, e *Error) error {
	if e == nil {
		return nil
	}
	if c.Response().Committed {
		return nil
	}
	render(c, e)
	return nil
}

// Handler is installed as echo's HTTPErrorHandler. It renders errors returned by
// handlers and middleware, Echo's own routing errors, and recovered panics.
func Handler(err error, c echo.Context) {
	if err == nil || c.Response().Committed {
		return
	}
	apiErr := From(err)
	if apiErr.Status >= http.StatusInternalServerError {
		// The client gets a generic sentence; the detail stays in the log.
		utils.LogErrorf("api error: %v", err)
	}
	render(c, apiErr)
}

// From translates any error into an *Error.
func From(err error) *Error {
	if err == nil {
		return nil
	}

	var apiErr *Error
	if errors.As(err, &apiErr) {
		return apiErr
	}

	var httpErr *echo.HTTPError
	if errors.As(err, &httpErr) {
		code := 0
		if httpErr != nil {
			code = httpErr.Code
		}
		status := code
		if status < 100 || status > 599 {
			status = http.StatusInternalServerError
		}
		message := http.StatusText(status)
		if status < http.StatusInternalServerError {
			switch m := httpErr.Message.(type) {
			case string:
				if m != "" {
					message = m
				}
			case error:
				if m != nil {
					message = m.Error()
				}
			}
		}
		if message == "" {
			message = "Internal Server Error"
		}
		return New(status, CodeForStatus(status), message)
	}

	return New(http.StatusInternalServerError, CodeInternal, "Internal Server Error")
}

// CodeForStatus is the fallback code for an error that only carries a status.
func CodeForStatus(status int) string {
	switch status {
	case http.StatusBadRequest:
		return CodeBadRequest
	case http.StatusUnauthorized:
		return CodeUnauthorized
	case http.StatusForbidden:
		return CodeForbidden
	case http.StatusNotFound:
		return CodeNotFound
	case http.StatusMethodNotAllowed:
		return CodeMethodNotAllowed
	case http.StatusConflict:
		return CodeConflict
	case http.StatusPreconditionFailed:
		return CodePreconditionFailed
	case http.StatusRequestEntityTooLarge:
		return CodePayloadTooLarge
	case http.StatusUnsupportedMediaType:
		return CodeUnsupportedMedia
	case http.StatusUnprocessableEntity:
		return CodeMediaTooLarge
	case http.StatusLocked:
		return CodeBitLockerLocked
	case http.StatusTooManyRequests:
		return CodeTooManyRequests
	case http.StatusNotImplemented:
		return CodeFeatureUnavailable
	case http.StatusServiceUnavailable:
		return CodeServerBusy
	default:
		return CodeInternal
	}
}

func render(c echo.Context, e *Error) {
	if e.RetryAfter > 0 {
		c.Response().Header().Set(echo.HeaderRetryAfter, strconv.Itoa(e.RetryAfter))
	}
	if err := c.JSON(e.Status, Payload{Code: e.Code, Message: e.Message, Details: e.Details}); err != nil {
		c.Logger().Error(err)
	}
}
