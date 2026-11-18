import Foundation
import FilesystemPlugin

public let isCapacitorApp = true

/**
 Capacitor registers SPM plugins through `packageClassList` + `NSClassFromString`.
 CapApp-SPM depends on plugin products, but without a live Swift reference the linker
 can dead-strip those classes. Then JS sees `isPluginAvailable("Filesystem") === false`
 / `filesystem-unavailable` even though CapacitorFilesystem appears in Xcode packages.

 Keep a retained reference so `@objc(FilesystemPlugin)` remains in the app binary.
 */
enum FreedomCapAppSPMPluginAnchor {
  static let linkedPluginClasses: [AnyClass] = [
    FilesystemPlugin.self
  ]
}

private let freedomRetainLinkedCapacitorPlugins: Int = {
  FreedomCapAppSPMPluginAnchor.linkedPluginClasses.count
}()
