import UIKit

@MainActor
final class ReylumiAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        ReylumiBackgroundSync.shared.registerScheduler()
        return true
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        ReylumiBackgroundSync.shared.schedule()
    }
}
