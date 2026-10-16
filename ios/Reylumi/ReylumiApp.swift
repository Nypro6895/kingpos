import SwiftUI

@main
struct ReylumiApp: App {
    @UIApplicationDelegateAdaptor(ReylumiAppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    @State private var marketReturnSequence = 0
    var body: some Scene {
        WindowGroup {
            ReylumiView(marketReturnSequence: marketReturnSequence)
                .ignoresSafeArea(.keyboard)
                .background(Color.white.ignoresSafeArea())
                .preferredColorScheme(.light)
                .onOpenURL { url in
                    if NavigationPolicy.isMarketReturn(url) { marketReturnSequence += 1 }
                }
        }
        .onChange(of: scenePhase) { phase in
            if phase == .background { ReylumiBackgroundSync.shared.schedule() }
        }
    }
}

struct ReylumiView: UIViewControllerRepresentable {
    var marketReturnSequence: Int
    func makeUIViewController(context: Context) -> ReylumiAppContainer {
        ReylumiAppContainer()
    }
    func updateUIViewController(_ controller: ReylumiAppContainer, context: Context) {
        controller.returnToMarket(sequence: marketReturnSequence)
    }
}
