package utils

import (
    "github.com/labstack/echo/v4"
)

func LogErrorsOnly() echo.MiddlewareFunc {
    return func(next echo.HandlerFunc) echo.HandlerFunc {
        return func(c echo.Context) error {
            err := next(c)
            if err != nil {
                c.Logger().Error(err)
                return err
            }
            return nil
        }
    }
}