import Foundation
import FilesystemPlugin
import LocalNotificationsPlugin

public let isCapacitorApp = true

/**
 Capacitor registers SPM plugins through `packageClassList` + `NSClassFromString`.
 CapApp-SPM depends on plugin products, but without a live Swift reference the linker
 can dead-strip those classes. Then JS sees `isPluginAvailable(...) === false`
 (for example `filesystem-unavailable`) even though the package appears in Xcode.

 Keep retained references so `@objc(FilesystemPlugin)` and
 `@objc(LocalNotificationsPlugin)` remain in the app binary.
 */
enum FreedomCapAppSPMPluginAnchor {
  static let linkedPluginClasses: [AnyClass] = [
    FilesystemPlugin.self,
    LocalNotificationsPlugin.self
  ]
}

private let freedomRetainLinkedCapacitorPlugins: Int = {
  FreedomCapAppSPMPluginAnchor.linkedPluginClasses.count
}()
