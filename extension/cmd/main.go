package main

import (
        "context"

        "net/http"
        "os"
        "os/signal"
        "syscall"

        "github.com/flare-foundation/go-flare-common/pkg/logger"

        "extension-scaffold/internal/config"
        extension "extension-scaffold/internal/extension"
)

func main() {
        e := extension.New(config.ExtensionPort, config.SignPort)

        // Start the RiskAgent loop in a background goroutine.
        // (Phase 1 Step 2 — the agent loop was previously never started.)
        // This runs the observe → score → decide → act → attest loop on every tick.
        e.StartRiskAgentLoop()

        // Graceful shutdown.
        sigChan := make(chan os.Signal, 1)
        signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
        go func() {
                <-sigChan
                ctx, cancel := context.WithTimeout(context.Background(), config.TimeoutShutdown)
                defer cancel()
                if err := e.Server.Shutdown(ctx); err != nil {
                        logger.Errorf("graceful shutdown: %v", err)
                }
                os.Exit(0)
        }()

        logger.Infof("starting extension server on :%d", config.ExtensionPort)
        err := e.Server.ListenAndServe()
        if err != nil && err != http.ErrServerClosed {
                logger.Fatalf("server: %v", err)
        }
}
