/// Bundle ids of the apps whose computer-use sidecar may drive this helper.
public enum TrustedVshuApplication {
    public static func isTrusted(bundleId: String) -> Bool {
        // Why: `pnpm dev` launches as `dev.vshu.app.dev` and per-worktree wrapper apps use
        // `dev.vshu.app.dev.<name>`; the sidecar peer check must authorize both (#26498).
        bundleId == "dev.vshu.app" ||
            bundleId == "dev.vshu.app.dev" ||
            bundleId.hasPrefix("dev.vshu.app.dev.") ||
            bundleId == "com.github.Electron"
    }
}
