import SwiftUI

@main
struct ReylumiApp: App {
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
    }
}

struct ReylumiView: UIViewControllerRepresentable {
    var marketReturnSequence: Int
    func makeUIViewController(context: Context) -> ReylumiViewController {
        ReylumiViewController()
    }
    func updateUIViewController(_ controller: ReylumiViewController, context: Context) {
        controller.returnToMarket(sequence: marketReturnSequence)
    }
}
