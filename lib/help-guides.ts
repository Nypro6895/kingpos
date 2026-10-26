import { WINDOWS_PORTABLE_HELP } from "./windows-portable-help";

export type HelpRole = "customer" | "owner" | "staff";
export type HelpImage = {src: string; width: number; height: number};
export type HelpScreenshot = {id: string; caption: string; alt: string; provenance: "source-grounded-simulation"; status: "illustrated"; desktop: HelpImage; mobile: HelpImage};
export type HelpSection = {id: string; title: string; illustrationId?: string; steps: string[]; check: string; example: string; issues: string[]};
export type HelpGuide = {slug: string; title: string; summary: string; roles: HelpRole[]; entry: {href: string; label: string}; prerequisite: string; steps: {title: string; body: string}[]; sections: HelpSection[]; notes: string[]; evidence: {sourceFiles: string[]; sourceReviewed: boolean; productionFlowVerified: boolean; screenshots: HelpScreenshot[]}};

export const HELP_VERSION = {
  "version": "2026-10-17.1",
  "reviewedAt": "2026-10-17",
  "sourceRevision": "dpl_GSM2JMJnitw6i9LGCUiX1H5Xr9Pm",
  "publicationStatus": "ready",
  "screenshotsStatus": "illustrated"
} as const;
export const HELP_GUIDES: readonly HelpGuide[] = [
  WINDOWS_PORTABLE_HELP,
  {
    "slug": "overview",
    "title": "Start with Reylumi",
    "summary": "Find the right workspace for what you want to do.",
    "roles": [
      "customer",
      "owner",
      "staff"
    ],
    "entry": {
      "href": "/my-place",
      "label": "Open My place"
    },
    "prerequisite": "You can browse public profiles before signing in. Account and salon tools have their own access requirements.",
    "steps": [
      {
        "title": "Choose your role",
        "body": "Customers discover salons and manage their bookings. Owners set up a salon and oversee its work. Linked staff use their own work area."
      },
      {
        "title": "Check the selected salon",
        "body": "Before changing services, staff, tickets or reports, check that you are working in the intended salon."
      },
      {
        "title": "Start small",
        "body": "Use the quick start for your role, then open a detailed guide when you need it. Some tools depend on permissions or an installed plugin."
      }
    ],
    "notes": [],
    "evidence": {
      "sourceFiles": [
        "app/(app)/my-place/page.tsx",
        "lib/route-context-guards.ts"
      ],
      "sourceReviewed": true,
      "screenshots": [
        {
          "id": "welcome",
          "caption": "My place: your account and salon connections",
          "alt": "Guide illustration of the customer, owner and linked staff workspaces; not the exact My place layout.",
          "provenance": "source-grounded-simulation",
          "status": "illustrated",
          "desktop": {
            "src": "/help/2026-10-15/welcome-desktop.jpg",
            "width": 1440,
            "height": 900
          },
          "mobile": {
            "src": "/help/2026-10-15/welcome-mobile.jpg",
            "width": 390,
            "height": 844
          }
        }
      ],
      "productionFlowVerified": false
    },
    "sections": [
      {
        "id": "choose-workspace",
        "title": "Find the right place to start",
        "steps": [
          "For a personal visit, start with Explore and My bookings. For salon management, first select your salon in My place.",
          "For your own shifts and earnings, use Staff Daily after your account has been connected to an active staff profile."
        ],
        "check": "You see the intended salon and the tools for your role.",
        "example": "A salon owner who also performs services needs both Owner access and a staff profile to appear in staff work and pay.",
        "issues": [
          "A missing tool can mean a different selected salon or a missing permission. Creating a second account does not fix that connection."
        ]
      }
    ]
  },
  {
    "slug": "owner-tips",
    "title": "Owner Tips: run your first salon day",
    "summary": "Install POS, serve a customer, understand the money and reconcile the day.",
    "roles": [
      "owner"
    ],
    "entry": {
      "href": "/pos/settings",
      "label": "Open POS settings"
    },
    "prerequisite": "Use an Owner account with access to the intended salon. Prepare active services and staff, a Windows computer or supported browser, and your separate card terminal if you accept cards.",
    "steps": [
      {
        "title": "Before opening",
        "body": "Open the correct salon, check staff and services, review bookings and syncing."
      },
      {
        "title": "For each customer",
        "body": "Check the customer, staff, services and total; collect the payment, record it once and verify Checkout."
      },
      {
        "title": "Before leaving",
        "body": "Sync tickets, count actual collections, compare the terminal report and save the correct business-day report."
      }
    ],
    "sections": [
      {
        "id": "install-pos",
        "title": "1. Open POS for the day",
        "steps": [
          "Open POS Settings → Install POS & customer display. On a Windows computer or touchscreen, choose Download Windows app when available. Share link can send the download address to the intended computer.",
          "Open the downloaded .exe and follow setup. Verify the publisher before approving the Windows prompt, then open the POS app.",
          "In POS settings → Staff access, an authorized manager creates an active POS ID and passcode and selects Allowed actions. Sign into the POS app with those credentials.",
          "Alternatively choose Run Portable in browser. Confirm the salon, then check the sync indicator before daily work. Internet is required for sign-in and syncing."
        ],
        "check": "The correct salon opens and the POS ID can perform only its allowed actions.",
        "example": "A reception POS ID can be limited to the actions needed at the desk; the owner keeps a separate personal management account.",
        "issues": [
          "Windows download unavailable: use the offered browser option or contact support. The Windows installer is not an iPad application.",
          "Do not clear browser/app data or reinstall while tickets are waiting to sync. Keep the same device and review the sync status first."
        ],
        "illustrationId": "pos-setup"
      },
      {
        "id": "prepare-day",
        "title": "Prepare the team and menu before opening",
        "steps": [
          "Check the salon name on POS. Have staff use POS Check-in for their own attendance and verify the intended staff profile.",
          "In Services, check the active menu, price and duration. In Staff, check who is active. For online appointments, also review eligible Booking staff and working availability.",
          "Review today’s bookings and the POS sync indicator. Confirm the external card terminal is ready before serving customers."
        ],
        "check": "You can select the correct staff and service, and today’s bookings are visible.",
        "example": "Mai is working today. Classic manicure is active at $35 for 45 minutes; Mai is assigned only to services she can perform.",
        "issues": [
          "Online booking availability and staff attendance are different. Checking in does not automatically create online booking hours."
        ],
        "illustrationId": "staff-setup"
      },
      {
        "id": "serve-customer",
        "title": "Build and review a customer ticket",
        "steps": [
          "Open the intended customer’s ticket from the POS or booking workflow. Check the customer and salon before adding services; do not use staff Check-in as customer check-in.",
          "On the ticket detail page, choose Add service to ticket → Add Item. Check the assigned staff for each line, quantity and price, then Save allowed changes.",
          "Review discount, tax and Tip Value if applicable. Confirm Ticket Total with the customer before collecting payment.",
          "Record the actual payment in Payments → Add Payment. Check that the balance is fully paid, use Checkout and verify the closed result."
        ],
        "check": "The closed ticket contains the correct customer, staff, services and payment entries.",
        "example": "Classic manicure $35 + Nail art $15 + tip $10 = $60 if no other tax or discount applies. The service lines total $50; the tip remains $10.",
        "issues": [
          "If Checkout is unavailable, check required staff assignments, ticket details and the outstanding amount. Do not add a second payment if the first one is already recorded."
        ],
        "illustrationId": "checkout"
      },
      {
        "id": "understand-money",
        "title": "Understand where each amount goes",
        "steps": [
          "Service lines contribute to service sales. Tips are recorded separately. Cash and Credit Card describe how the customer paid the total; they are not extra sales on top of the ticket.",
          "The assigned staff and their configured pay rules determine calculated commission or wages. Review Payroll → Staff Income for the breakdown, rather than treating all customer cash as staff pay.",
          "Keep actual staff payments separate from the calculation. Mark Paid records the saved statement status; it does not transfer cash or money from a bank."
        ],
        "check": "You can explain service sales, tips, customer payment methods and staff income as separate amounts.",
        "example": "For a $50 service total and $10 tip, the customer pays $60. At a 60% service commission, the service commission is $30 before other pay rules. Tip treatment follows the configured payroll rules.",
        "issues": [
          "Do not add ticket total and payment total together as revenue: they describe the same collection. Do not assume every tip is paid out immediately."
        ],
        "illustrationId": "money-flow"
      },
      {
        "id": "external-terminal",
        "title": "Use your own card terminal with POS",
        "steps": [
          "Check the final amount with the customer. Enter the intended charge on your external terminal and follow that terminal’s payment process.",
          "Confirm the terminal reports success. On the Reylumi ticket detail page, choose the matching Method, such as Credit Card or Debit Card, enter only the amount successfully collected and choose Add Payment.",
          "For cash plus card, record each actual amount separately. Keep the terminal receipt or reference available for end-of-day reconciliation, then complete Checkout when fully paid."
        ],
        "check": "The terminal charge and the POS card entry agree; the ticket has no remaining unpaid balance.",
        "example": "For a $60 ticket paid $20 cash and $40 by credit card, record $20 Cash and $40 Credit Card after the $40 terminal charge succeeds.",
        "issues": [
          "If a terminal response is unclear, inspect its transaction history before retrying. Entering Add Payment in Reylumi does not charge that terminal.",
          "A POS correction or cancellation does not prove that an external card refund happened. Verify any actual refund with the terminal provider."
        ],
        "illustrationId": "external-card"
      },
      {
        "id": "close-business-day",
        "title": "6. Close and reconcile the day",
        "steps": [
          "Open POS → Report and select the business date. Check that saved tickets have synced; pending uploads can make the report incomplete.",
          "In Closing Inputs, enter actual Cash, Credit Card and Other collections for that date. Use the terminal’s matching business-day transactions for card collections, not an unrelated bank payout.",
          "Review Actual Total, Expected total and Difference in Reconciliation. Record an explanation in Note when something needs checking, then choose Save.",
          "Wait for Saved and reopen the same date to verify the entries. If the date is locked, follow the main report correction workflow available to your role."
        ],
        "check": "Saved closing amounts remain after reload, and any difference has been investigated rather than hidden by changing a sale.",
        "example": "Expected total is $520. Actual Cash $220, Credit Card $300 and Other $0 give Actual Total $520 and Difference $0. Opening cash kept in the drawer is not new sales collected today.",
        "issues": [
          "Unsynced tickets: reconnect and review the sync indicator before final comparison. A local draft is not the saved report.",
          "Closing amounts changed on another screen: review Use saved amounts and Keep my entries for review. Compare values before saving again.",
          "Card fees, refunds and settlement timing can make a bank deposit different from gross terminal collections. Review the terminal statement separately."
        ],
        "illustrationId": "reports"
      },
      {
        "id": "owner-remote",
        "title": "7. Review remotely",
        "steps": [
          "Sign in with your Owner account and select the salon in My place. Open Bookings, Today or Reports for the task you need.",
          "Check the business date, period and status filters before comparing numbers with the reception POS. Open a specific booking or ticket to investigate a difference.",
          "If a view looks old, reload and confirm the POS has synced. Ask the person at the salon to verify physical cash or an external terminal result when needed."
        ],
        "check": "The same salon and date show consistent saved records across devices.",
        "example": "The owner checks today’s card entries on a phone, then compares them with the receptionist’s terminal report for that same date.",
        "issues": [
          "A remote report cannot confirm how much cash is physically in the drawer or whether an external terminal actually charged a card."
        ],
        "illustrationId": "owner-remote"
      },
      {
        "id": "triage",
        "title": "8. Resolve common mistakes",
        "steps": [
          "Check account, salon, date and permissions first. For a staff portal, confirm the active linked staff profile; for a POS device, confirm its POS ID and allowed actions.",
          "Check the saved outcome: booking list for an appointment, ticket/payment entries for checkout, My Applications for a connection and the saved period for payroll.",
          "For device sync problems, keep the device data, reconnect and inspect the sync indicator. For conflicting edits, compare the latest saved record before choosing which values to keep.",
          "Open Help & support from the affected screen. Include the task, page, time, exact error and what you expected. Hide private contact, payroll and setup-link information in screenshots."
        ],
        "check": "Support receives enough context to locate the failed step without passwords, codes or unrelated private records.",
        "example": "Useful report: “Create Salon → Drayko Demo → Could not check existing salons, around 10:15; no salon appeared afterward.”",
        "issues": [
          "Do not repeatedly charge a card, create duplicate salons or submit the same booking while the original outcome is uncertain."
        ],
        "illustrationId": "support"
      }
    ],
    "notes": [],
    "evidence": {
      "sourceFiles": [
        "app/(app)/services/page.tsx",
        "app/(app)/staff/page.tsx",
        "app/(app)/salon-settings/page.tsx",
        "lib/public-booking.ts",
        "app/bookings/booking-workspace-client.tsx",
        "app/booking-setup/booking-setup-editors.tsx",
        "app/(app)/pos/settings/page.tsx",
        "app/pos/settings/desktop-download-panel.tsx",
        "app/pos/settings/customer-display-install-panel.tsx",
        "app/(app)/staff/my-work/page.tsx",
        "components/windows-pos-download.tsx",
        "app/check-in/[entry]/page.tsx",
        "app/(app)/pos/(workspace)/check-in/page.tsx",
        "app/(app)/pos/(workspace)/ticket/page.tsx",
        "app/(app)/pos-tickets/[ticketId]/page.tsx",
        "app/(app)/payroll/page.tsx",
        "app/(app)/payroll/tax-company/page.tsx",
        "app/(app)/tax-company/page.tsx",
        "app/(app)/reports/page.tsx",
        "app/(app)/pos/(workspace)/report/page.tsx",
        "app/(app)/staff/today/page.tsx",
        "app/pos/portable/report/portable-report-closing-form.tsx",
        "lib/pos-payments.ts",
        "components/windows-pos-download.tsx"
      ],
      "sourceReviewed": true,
      "productionFlowVerified": false,
      "screenshots": [
        {
          "id": "pos-setup",
          "caption": "Open POS and display setup",
          "alt": "Mockup of Staff access creation, Allowed actions and Customer Display setup requiring an active POS ID.",
          "provenance": "source-grounded-simulation",
          "status": "illustrated",
          "desktop": {
            "src": "/help/2026-10-15/pos-setup-desktop.jpg",
            "width": 1440,
            "height": 1225
          },
          "mobile": {
            "src": "/help/2026-10-15/pos-setup-mobile.jpg",
            "width": 390,
            "height": 1442
          }
        },
        {
          "id": "staff-setup",
          "caption": "Prepare staff and service access",
          "alt": "Mockup of an active staff profile, Edit, Save staff changes and an account search for an invitation.",
          "provenance": "source-grounded-simulation",
          "status": "illustrated",
          "desktop": {
            "src": "/help/2026-10-15/staff-setup-desktop.jpg",
            "width": 1440,
            "height": 900
          },
          "mobile": {
            "src": "/help/2026-10-15/staff-setup-mobile.jpg",
            "width": 390,
            "height": 844
          }
        },
        {
          "id": "checkout",
          "caption": "Ticket detail: Add Payment, then Checkout when eligible",
          "alt": "Mockup of the ticket detail payment form with Method, Amount, Add Payment and Checkout.",
          "provenance": "source-grounded-simulation",
          "status": "illustrated",
          "desktop": {
            "src": "/help/2026-10-15/checkout-desktop.jpg",
            "width": 1440,
            "height": 939
          },
          "mobile": {
            "src": "/help/2026-10-15/checkout-mobile.jpg",
            "width": 390,
            "height": 982
          }
        },
        {
          "id": "money-flow",
          "caption": "One ticket, separate service, tip and payment totals",
          "alt": "Illustration: $50 services and $10 tip total $60, paid $20 cash and $40 card; example service commission is $30.",
          "provenance": "source-grounded-simulation",
          "status": "illustrated",
          "desktop": {
            "src": "/help/2026-10-15/money-flow-desktop.jpg",
            "width": 1440,
            "height": 900
          },
          "mobile": {
            "src": "/help/2026-10-15/money-flow-mobile.jpg",
            "width": 390,
            "height": 966
          }
        },
        {
          "id": "external-card",
          "caption": "Confirm the terminal charge, then record it in Payments",
          "alt": "Illustration of checking an external terminal result and recording Credit Card 40.00 with a separate Cash 20.00 entry.",
          "provenance": "source-grounded-simulation",
          "status": "illustrated",
          "desktop": {
            "src": "/help/2026-10-15/external-card-desktop.jpg",
            "width": 1440,
            "height": 900
          },
          "mobile": {
            "src": "/help/2026-10-15/external-card-mobile.jpg",
            "width": 390,
            "height": 1001
          }
        },
        {
          "id": "reports",
          "caption": "Compare payment records with actual receipts",
          "alt": "Explanatory comparison of sample cash and external card payment records, with a total of 520 dollars.",
          "provenance": "source-grounded-simulation",
          "status": "illustrated",
          "desktop": {
            "src": "/help/2026-10-15/reports-desktop.jpg",
            "width": 1440,
            "height": 1061
          },
          "mobile": {
            "src": "/help/2026-10-15/reports-mobile.jpg",
            "width": 390,
            "height": 1184
          }
        },
        {
          "id": "owner-remote",
          "caption": "Check the same salon and business date on your phone",
          "alt": "Illustration of an owner comparing saved Reports with a matching POS business date and terminal receipt.",
          "provenance": "source-grounded-simulation",
          "status": "illustrated",
          "desktop": {
            "src": "/help/2026-10-15/owner-remote-desktop.jpg",
            "width": 1440,
            "height": 900
          },
          "mobile": {
            "src": "/help/2026-10-15/owner-remote-mobile.jpg",
            "width": 390,
            "height": 916
          }
        },
        {
          "id": "support",
          "caption": "Send a useful support request",
          "alt": "Demo support screen with an example issue and no customer or private account records.",
          "provenance": "source-grounded-simulation",
          "status": "illustrated",
          "desktop": {
            "src": "/help/2026-10-15/support-desktop.jpg",
            "width": 1440,
            "height": 900
          },
          "mobile": {
            "src": "/help/2026-10-15/support-mobile.jpg",
            "width": 390,
            "height": 844
          }
        }
      ]
    }
  },
  {
    "slug": "account",
    "title": "Create and access your account",
    "summary": "Sign in and keep your personal account separate from salon access.",
    "roles": [
      "customer",
      "owner",
      "staff"
    ],
    "entry": {
      "href": "/signup",
      "label": "Open sign up"
    },
    "prerequisite": "Use your own email and the sign-in method offered on the screen.",
    "steps": [
      {
        "title": "Create an account or sign in",
        "body": "Open sign up if you are new, or sign in to your existing account. Complete any verification shown before continuing."
      },
      {
        "title": "Fill in the account form",
        "body": "On Create account, enter your display name, email and password, then choose Create account. If verification is requested, finish it before signing in."
      },
      {
        "title": "Review My place",
        "body": "Open My place to see the places and roles connected to your account. A personal account alone does not grant salon management access."
      },
      {
        "title": "Use the right account",
        "body": "If a salon or staff area is missing, confirm the signed-in account and ask the salon owner to check your connection."
      }
    ],
    "notes": [],
    "evidence": {
      "sourceFiles": [
        "app/(app)/signup/page.tsx",
        "app/(app)/my-place/page.tsx",
        "app/(app)/settings/login-security/page.tsx"
      ],
      "sourceReviewed": true,
      "screenshots": [
        {
          "id": "signup",
          "caption": "Create an account",
          "alt": "Demo sign-up form with display name, email and password fields.",
          "provenance": "source-grounded-simulation",
          "status": "illustrated",
          "desktop": {
            "src": "/help/2026-10-15/signup-desktop.jpg",
            "width": 1440,
            "height": 900
          },
          "mobile": {
            "src": "/help/2026-10-15/signup-mobile.jpg",
            "width": 390,
            "height": 844
          }
        }
      ],
      "productionFlowVerified": false
    },
    "sections": [
      {
        "id": "account-access",
        "title": "Sign up, sign in and check access",
        "steps": [
          "On Create account, enter your display name, email and password. Check the email address before submitting and complete the verification requested on screen.",
          "Return to Sign in using the same account. Open My place and check the salon name and role before editing salon information.",
          "Use Settings → Login & security to review the account controls available to you. Keep your personal sign-in separate from a shared POS ID."
        ],
        "check": "My place shows the correct account and any accepted salon connections.",
        "example": "Mai accepts a staff invitation while signed in to Mai’s own email. The salon then appears under that account.",
        "issues": [
          "No salon after sign-in: compare the invitation’s intended account with the email you used, then ask the owner to check the link.",
          "If verification or sign-in fails, keep the error message for support; never send your password or verification code."
        ]
      }
    ]
  },
  {
    "slug": "find-and-book",
    "title": "Find, follow and book",
    "summary": "Discover a salon, choose an available service and keep track of your appointment.",
    "roles": [
      "customer"
    ],
    "entry": {
      "href": "/explore",
      "label": "Open Explore"
    },
    "prerequisite": "A salon needs to offer online booking with eligible services, staff and available times.",
    "steps": [
      {
        "title": "Explore profiles",
        "body": "Search Explore and open a salon or beauty profile. Use the save or follow control available on that profile to find it again."
      },
      {
        "title": "Choose services and staff",
        "body": "Open the salon booking link. Select the services you need and a staff member when that option is offered. Check the estimated duration and price."
      },
      {
        "title": "Choose an available start time",
        "body": "Pick a date, then choose an available start time. If no time is offered, try another date or service and check with the salon; an unavailable slot cannot be booked."
      },
      {
        "title": "Review and confirm",
        "body": "At the confirmation step, review the salon, services, staff, date, time and customer details. The final action can be Confirm booking, Request appointment or Continue to payment, depending on salon settings. Read any deposit and cancellation terms."
      },
      {
        "title": "Read the booking status",
        "body": "Read the result after submitting: Booking confirmed confirms the appointment; Request received or Awaiting salon confirmation still needs the salon response. Signed-in linked bookings appear in My bookings. Guest bookings may use a secure Manage booking link; keep it private."
      },
      {
        "title": "Check the result",
        "body": "For an account-linked booking, open My bookings and choose Details. For a guest booking, use its secure manage link. Use only the change or cancellation options offered for that appointment; salon rules can limit them."
      }
    ],
    "notes": [
      "If a deposit is shown, review the amount and terms before choosing to pay. A payment page is not an appointment confirmation."
    ],
    "evidence": {
      "sourceFiles": [
        "app/(app)/book/[salonId]/page.tsx",
        "lib/public-booking.ts",
        "app/(app)/my-bookings/page.tsx"
      ],
      "sourceReviewed": true,
      "screenshots": [
        {
          "id": "explore",
          "caption": "Find a salon in Explore",
          "alt": "Illustrative Drayko Demo salon card with sample services and a reminder to use the available booking control.",
          "provenance": "source-grounded-simulation",
          "status": "illustrated",
          "desktop": {
            "src": "/help/2026-10-15/explore-desktop.jpg",
            "width": 1440,
            "height": 900
          },
          "mobile": {
            "src": "/help/2026-10-15/explore-mobile.jpg",
            "width": 390,
            "height": 844
          }
        },
        {
          "id": "booking",
          "caption": "Choose an available time",
          "alt": "Demo booking screen with service, staff, date and available start times.",
          "provenance": "source-grounded-simulation",
          "status": "illustrated",
          "desktop": {
            "src": "/help/2026-10-15/booking-desktop.jpg",
            "width": 1440,
            "height": 900
          },
          "mobile": {
            "src": "/help/2026-10-15/booking-mobile.jpg",
            "width": 390,
            "height": 844
          }
        },
        {
          "id": "booking-confirmed",
          "caption": "Read the appointment status",
          "alt": "Mockup of a Confirmed booking card with the Details button and Upcoming, Past and Cancelled tabs.",
          "provenance": "source-grounded-simulation",
          "status": "illustrated",
          "desktop": {
            "src": "/help/2026-10-15/booking-confirmed-desktop.jpg",
            "width": 1440,
            "height": 900
          },
          "mobile": {
            "src": "/help/2026-10-15/booking-confirmed-mobile.jpg",
            "width": 390,
            "height": 844
          }
        }
      ],
      "productionFlowVerified": false
    },
    "sections": [
      {
        "id": "discover-follow",
        "title": "Find and return to a salon",
        "steps": [
          "Open Explore, search the salon or service you want and check the location on the result before opening its profile.",
          "Read the profile and service information. Use Follow on a profile or the save control on a post when offered; sign in if requested.",
          "Choose Book or the salon’s direct booking link. Confirm the salon name again before selecting a service."
        ],
        "check": "The selected booking page names the salon you intended to visit.",
        "example": "Search “manicure”, open Drayko Demo and choose its booking link. Following a profile does not reserve a time.",
        "issues": [
          "If there is no booking action, the profile may not currently offer online booking. Contact the salon instead of assuming a time is reserved."
        ]
      },
      {
        "id": "booking-status",
        "title": "Finish a booking and recognize its status",
        "steps": [
          "Choose the service, an offered staff option, a date and an available start time. Review the price, duration and contact information.",
          "Read the final button: Confirm booking confirms directly; Request appointment asks the salon to respond; Continue to payment opens the required payment step.",
          "Read the result and retain the booking reference. Open My bookings → Details for a linked booking, or the private Manage booking link for a guest booking.",
          "For a change or cancellation, open that booking and use the action offered there. Check the resulting status after submitting."
        ],
        "check": "Booking confirmed means confirmed. Request received or Awaiting salon confirmation means a response is still needed.",
        "example": "Mai requests a 10:00 appointment. While Awaiting salon confirmation is shown, Mai has submitted a request, not a confirmed appointment.",
        "issues": [
          "No time offered: check a different date or staff option. A service duration, break or time off can make an otherwise open day unavailable.",
          "Slow response: check the booking list or manage link before submitting again. Keep guest manage links private."
        ]
      }
    ]
  },
  {
    "slug": "open-or-claim",
    "title": "Open or claim your salon",
    "summary": "Create a new salon or request management of an existing directory listing.",
    "roles": [
      "owner"
    ],
    "entry": {
      "href": "/salons",
      "label": "Open your salons"
    },
    "prerequisite": "Sign in and confirm that you own the business or are authorized to manage it.",
    "steps": [
      {
        "title": "Look for the salon first",
        "body": "Check your salons and search the existing directory before creating another listing for the same business."
      },
      {
        "title": "Enter the new salon details",
        "body": "Open Create Salon and enter the salon name. Phone and address fields can be left blank when optional. Select I also work as staff at this salon only if you want a staff profile as well as Owner access."
      },
      {
        "title": "Review existing salon matches",
        "body": "Wait for the existing-salon check. If your business is listed, use its claim option. If the check reports an error, stop and retry or contact support before creating another listing."
      },
      {
        "title": "Verify an existing listing",
        "body": "Check the listed business phone and confirm that you are authorized. Choose Send SMS code or Call me with a code only when enabled. After sending, enter the Six-digit code and choose Confirm code. If you cannot receive it, choose Can’t access this phone? Request support."
      },
      {
        "title": "Wait for the actual outcome",
        "body": "A confirmed phone code may still require ownership review. Read the request status and continue the support conversation when more information is requested. Configure booking separately after management access is granted."
      }
    ],
    "notes": [
      "Do not create duplicate salons when an existing-salon check fails. Retry later or send the error to support."
    ],
    "evidence": {
      "sourceFiles": [
        "app/(app)/salons/new/page.tsx",
        "app/salons/salon-management-page.tsx",
        "app/claim/claim-panel.tsx"
      ],
      "sourceReviewed": true,
      "screenshots": [
        {
          "id": "salon-new",
          "caption": "Create Salon and the optional staff profile",
          "alt": "Demo new-salon form with salon name, contact fields and the staff-profile checkbox.",
          "provenance": "source-grounded-simulation",
          "status": "illustrated",
          "desktop": {
            "src": "/help/2026-10-15/salon-new-desktop.jpg",
            "width": 1440,
            "height": 900
          },
          "mobile": {
            "src": "/help/2026-10-15/salon-new-mobile.jpg",
            "width": 390,
            "height": 1114
          }
        },
        {
          "id": "claim",
          "caption": "Claim: code request, code entry and review are separate states",
          "alt": "Mockup separating the code request, six-digit code entry and waiting-for-review states. No verification or approval occurred.",
          "provenance": "source-grounded-simulation",
          "status": "illustrated",
          "desktop": {
            "src": "/help/2026-10-15/claim-desktop.jpg",
            "width": 1440,
            "height": 900
          },
          "mobile": {
            "src": "/help/2026-10-15/claim-mobile.jpg",
            "width": 390,
            "height": 931
          }
        }
      ],
      "productionFlowVerified": false
    },
    "sections": [
      {
        "id": "create-claim-outcome",
        "title": "Create a new salon or request an existing one",
        "steps": [
          "Open Create Salon, enter the salon name and add the phone and address if available. Select I also work as staff at this salon only if you perform services.",
          "Wait for the existing-salon suggestions. Compare names and addresses. Use the claim option for the same business; create a new salon only when it is a different listing.",
          "For a claim, check the listed business phone and authorization statement. Use Send SMS code or Call me with a code if enabled, then enter the Six-digit code and Confirm code.",
          "If you cannot receive a code, choose Can’t access this phone? Request support. Follow the request status until access is granted; verification may still need ownership review."
        ],
        "check": "Your salon appears with Owner access. Then continue to Services, Staff and Bookings setup before sharing a booking link.",
        "example": "Drayko Demo already exists at the same address: request that listing instead of making “Drayko Demo 2”.",
        "issues": [
          "Could not check existing salons: the lookup did not complete. Optional blank phone/address fields are not by themselves a reason to create duplicates. Retry later or send the exact error to support.",
          "A code sent or a request submitted does not yet mean Owner access was granted."
        ]
      }
    ]
  },
  {
    "slug": "staff-connections",
    "title": "Connect as a staff member",
    "summary": "Link your account to the correct salon and find your work area.",
    "roles": [
      "staff",
      "owner"
    ],
    "entry": {
      "href": "/staff/connections",
      "label": "Open staff connections"
    },
    "prerequisite": "The salon must have an active staff profile linked to your account before staff work tools are available.",
    "steps": [
      {
        "title": "Review your connection",
        "body": "Open staff connections to review the connection options available to your account. If the owner sends an invitation, open it while signed in to the intended account."
      },
      {
        "title": "Confirm the salon",
        "body": "Check the salon and staff profile before accepting a connection. Ask the owner to correct a wrong or inactive profile."
      },
      {
        "title": "Open Staff Daily",
        "body": "Use Staff Daily for your own work and appointments. It requires an active linked staff profile; the owner Today dashboard is a different workspace."
      },
      {
        "title": "Check your appointments and pay",
        "body": "Use Appointments to open an assigned booking and its customer or service notes. In Staff Daily, Today shows current work and My Pay shows the available payroll records for your linked profile."
      }
    ],
    "notes": [],
    "evidence": {
      "sourceFiles": [
        "app/(app)/staff/connections/page.tsx",
        "app/(app)/staff/invite/[token]/page.tsx",
        "app/(app)/staff/my-work/page.tsx",
        "app/staff/my-work/staff-my-work-view.tsx"
      ],
      "sourceReviewed": true,
      "screenshots": [
        {
          "id": "connections",
          "caption": "Check a staff connection",
          "alt": "Mockup of a connected staff profile, Open staff workplace, and separate invitation Accept and Decline options.",
          "provenance": "source-grounded-simulation",
          "status": "illustrated",
          "desktop": {
            "src": "/help/2026-10-15/connections-desktop.jpg",
            "width": 1440,
            "height": 1059
          },
          "mobile": {
            "src": "/help/2026-10-15/connections-mobile.jpg",
            "width": 390,
            "height": 1219
          }
        },
        {
          "id": "staff-daily",
          "caption": "Use your own Staff Daily workspace",
          "alt": "Illustrative Staff Daily summary with sample service income, tips and assigned tickets.",
          "provenance": "source-grounded-simulation",
          "status": "illustrated",
          "desktop": {
            "src": "/help/2026-10-15/staff-daily-desktop.jpg",
            "width": 1440,
            "height": 900
          },
          "mobile": {
            "src": "/help/2026-10-15/staff-daily-mobile.jpg",
            "width": 390,
            "height": 844
          }
        },
        {
          "id": "staff-appointments",
          "caption": "Review an assigned appointment",
          "alt": "Demo appointment details with a fictitious customer phone and service notes.",
          "provenance": "source-grounded-simulation",
          "status": "illustrated",
          "desktop": {
            "src": "/help/2026-10-15/staff-appointments-desktop.jpg",
            "width": 1440,
            "height": 900
          },
          "mobile": {
            "src": "/help/2026-10-15/staff-appointments-mobile.jpg",
            "width": 390,
            "height": 844
          }
        }
      ],
      "productionFlowVerified": false
    },
    "sections": [
      {
        "id": "staff-application",
        "title": "Apply to a salon or accept an invitation",
        "steps": [
          "Open Staff connections → Apply to Salon. Enter Salon name, City or State and choose Search. Only active salons that accept staff applications appear.",
          "Check the address, enter Requested title and a short Message, then choose Apply. Follow the request under My Applications.",
          "For an owner invitation, open Invitations, verify the salon and choose Accept or Decline. Open staff workplace becomes available for an accepted connection."
        ],
        "check": "The connection is accepted and the linked staff profile is active in the intended salon.",
        "example": "Mai searches Drayko Demo, enters “Nail technician” and applies. Pending means the owner has not accepted it yet.",
        "issues": [
          "No matching salon: check spelling and city; the salon may not accept applications. Ask the owner for an invitation.",
          "Use Cancel application for an incorrect pending request. Do not accept a different salon or staff identity just to gain access."
        ]
      },
      {
        "id": "staff-daily",
        "title": "Use Staff Daily on your own device",
        "steps": [
          "Sign in with your linked personal account, choose the correct salon and open Staff Daily.",
          "Open Today for your tickets. Open Appointments for your assigned bookings and their customer/service details. Check the date before acting.",
          "Open My Pay and select the period to review your available payroll record. On iPhone/iPad, you can save this private page with Safari → Share → Add to Home Screen if offered."
        ],
        "check": "Your name, assigned work and selected period match your staff profile.",
        "example": "Mai uses Staff Daily on her phone; a separate iPad at reception shows Customer Display.",
        "issues": [
          "No active staff profile is linked: ask the owner to review the account connection and active status. A POS ID is not a personal staff account.",
          "Staff Daily contains private work and pay information. It is not a public staff-display pairing screen."
        ]
      }
    ]
  },
  {
    "slug": "booking-setup",
    "title": "Prepare your salon for booking",
    "summary": "Set up services, staff and available times before sharing a booking link.",
    "roles": [
      "owner"
    ],
    "entry": {
      "href": "/services",
      "label": "Open Services"
    },
    "prerequisite": "Select the correct salon and use an account with the required service, staff and booking permissions.",
    "steps": [
      {
        "title": "Prepare services",
        "body": "In Services, check prices and durations. Active in salon and Online booking are separate controls. Online booking is off by default for a new service; enable it when ready and configure eligible Booking staff."
      },
      {
        "title": "Prepare the team and hours",
        "body": "Check active staff profiles, the services each person can provide and their working availability. Review the salon booking settings."
      },
      {
        "title": "Check booking availability",
        "body": "Open Bookings, then Settings (or /bookings?tab=settings). Review Booking enabled, Online booking visible, Confirmation mode and Timezone; save with Save settings. Set staff booking availability separately. Salon settings → Operating status describes public open/closed hours and does not replace booking setup."
      },
      {
        "title": "Verify the customer flow",
        "body": "Open the salon booking link as a customer and verify that the intended services and times are offered. Confirm one authorized test appointment and check that it appears in the salon workspace before sharing the link widely."
      }
    ],
    "notes": [
      "A visible public salon profile does not by itself prove that online booking is ready."
    ],
    "evidence": {
      "sourceFiles": [
        "app/(app)/services/page.tsx",
        "app/(app)/staff/page.tsx",
        "app/(app)/salon-settings/page.tsx",
        "lib/public-booking.ts",
        "app/bookings/booking-workspace-client.tsx",
        "app/booking-setup/booking-setup-editors.tsx"
      ],
      "sourceReviewed": true,
      "screenshots": [
        {
          "id": "services",
          "caption": "Services: Active and Online booking are separate",
          "alt": "Mockup comparing two active services, one with online booking on and eligible staff and one with online booking off.",
          "provenance": "source-grounded-simulation",
          "status": "illustrated",
          "desktop": {
            "src": "/help/2026-10-15/services-desktop.jpg",
            "width": 1440,
            "height": 900
          },
          "mobile": {
            "src": "/help/2026-10-15/services-mobile.jpg",
            "width": 390,
            "height": 880
          }
        },
        {
          "id": "staff-setup",
          "caption": "Prepare staff and service access",
          "alt": "Mockup of an active staff profile, Edit, Save staff changes and an account search for an invitation.",
          "provenance": "source-grounded-simulation",
          "status": "illustrated",
          "desktop": {
            "src": "/help/2026-10-15/staff-setup-desktop.jpg",
            "width": 1440,
            "height": 900
          },
          "mobile": {
            "src": "/help/2026-10-15/staff-setup-mobile.jpg",
            "width": 390,
            "height": 844
          }
        },
        {
          "id": "booking-settings",
          "caption": "Booking settings: publishing controls and confirmation",
          "alt": "Mockup of Booking enabled, Online booking visible, Confirmation mode and Timezone, with a reminder to set staff availability separately.",
          "provenance": "source-grounded-simulation",
          "status": "illustrated",
          "desktop": {
            "src": "/help/2026-10-15/booking-settings-desktop.jpg",
            "width": 1440,
            "height": 900
          },
          "mobile": {
            "src": "/help/2026-10-15/booking-settings-mobile.jpg",
            "width": 390,
            "height": 844
          }
        }
      ],
      "productionFlowVerified": false
    },
    "sections": [
      {
        "id": "service-staff-readiness",
        "title": "Prepare one bookable service from start to finish",
        "steps": [
          "In Services, review the service name, price and duration. Keep Active in salon enabled for services you offer. Enable Online booking separately for those customers may book online.",
          "Review Booking staff for that service and choose eligible active staff. A service without eligible staff or working hours will not produce bookable times.",
          "In booking setup, open Staff availability and select the professional. Enter Weekly hours, breaks and Time off, then save the changes."
        ],
        "check": "The intended service and staff appear together with available times on the customer booking page.",
        "example": "A 45-minute service needs a full 45-minute opening in the selected staff schedule; a 30-minute gap is not enough.",
        "issues": [
          "Active in salon does not enable Online booking. Check both controls and the staff schedule when a service is missing."
        ]
      },
      {
        "id": "go-live-link",
        "title": "Open online booking and share the right link",
        "steps": [
          "Open Bookings → Settings. Review Booking enabled, Online booking visible, Confirmation mode and Timezone, then choose Save settings.",
          "Open the salon’s public booking link from its profile. The booking address uses /book/ followed by the salon identifier; share that opened address, not a private admin or guest manage link.",
          "Before sharing widely, check services and times on a customer device. If you create an authorized test booking, check its actual result and the salon’s booking list."
        ],
        "check": "The link opens the correct salon and the chosen confirmation mode behaves as intended.",
        "example": "A salon using requests should expect Request received first, then a salon response.",
        "issues": [
          "Operating status in Salon settings describes public opening hours; it does not replace online booking controls and staff availability."
        ]
      }
    ]
  },
  {
    "slug": "pos-and-displays",
    "title": "Set up POS and displays",
    "summary": "Choose the POS workspace and connect a customer display when needed.",
    "roles": [
      "owner",
      "staff"
    ],
    "entry": {
      "href": "/pos/settings",
      "label": "Open POS settings"
    },
    "prerequisite": "Use an authorized salon account or device session. Download and setup options depend on your salon and the available release.",
    "steps": [
      {
        "title": "Choose how to open POS",
        "body": "In POS settings, review the Windows download when available or open Portable in the browser. Follow the setup shown for that edition."
      },
      {
        "title": "Connect the customer display",
        "body": "Use the Customer Display setup link or QR code from POS settings on the intended device. Verify the correct salon and a test ticket before using it with customers."
      },
      {
        "title": "Pair the display device",
        "body": "In POS settings → Staff access, an authorized manager creates a POS ID and passcode and reviews Allowed actions. An active POS ID is required to pair Customer Display. Enter those credentials on the intended display device; keep them and the setup link private."
      },
      {
        "title": "Add the screen to an iPad",
        "body": "Open the intended screen in Safari. Use Share, then Add to Home Screen when available. Launch the saved icon and verify the salon and display connection again."
      },
      {
        "title": "Keep staff work separate",
        "body": "Staff Daily and staff appointments are signed-in work areas. Customer Display is a customer-facing screen. Do not show staff account details or payroll on a public display."
      }
    ],
    "notes": [
      "A separate public staff-display setup has not been verified in this guide. Do not treat Staff Daily as that feature."
    ],
    "evidence": {
      "sourceFiles": [
        "app/(app)/pos/settings/page.tsx",
        "app/pos/settings/desktop-download-panel.tsx",
        "app/pos/settings/customer-display-install-panel.tsx",
        "app/(app)/staff/my-work/page.tsx",
        "components/windows-pos-download.tsx"
      ],
      "sourceReviewed": true,
      "screenshots": [
        {
          "id": "pos-setup",
          "caption": "Open POS and display setup",
          "alt": "Mockup of Staff access creation, Allowed actions and Customer Display setup requiring an active POS ID.",
          "provenance": "source-grounded-simulation",
          "status": "illustrated",
          "desktop": {
            "src": "/help/2026-10-15/pos-setup-desktop.jpg",
            "width": 1440,
            "height": 1225
          },
          "mobile": {
            "src": "/help/2026-10-15/pos-setup-mobile.jpg",
            "width": 390,
            "height": 1442
          }
        },
        {
          "id": "display-pair",
          "caption": "Pair a customer display",
          "alt": "Demo pairing form with clearly fictional POS ID and passcode.",
          "provenance": "source-grounded-simulation",
          "status": "illustrated",
          "desktop": {
            "src": "/help/2026-10-15/display-pair-desktop.jpg",
            "width": 1440,
            "height": 900
          },
          "mobile": {
            "src": "/help/2026-10-15/display-pair-mobile.jpg",
            "width": 390,
            "height": 844
          }
        },
        {
          "id": "customer-display",
          "caption": "Check what the customer sees",
          "alt": "Demo customer-facing ticket display with services and a sample total.",
          "provenance": "source-grounded-simulation",
          "status": "illustrated",
          "desktop": {
            "src": "/help/2026-10-15/customer-display-desktop.jpg",
            "width": 1440,
            "height": 900
          },
          "mobile": {
            "src": "/help/2026-10-15/customer-display-mobile.jpg",
            "width": 390,
            "height": 844
          }
        }
      ],
      "productionFlowVerified": false
    },
    "sections": [
      {
        "id": "install-pos",
        "title": "Install Windows POS or open Portable",
        "steps": [
          "Open POS Settings → Install POS & customer display. On a Windows computer or touchscreen, choose Download Windows app when available. Share link can send the download address to the intended computer.",
          "Open the downloaded .exe and follow setup. Verify the publisher before approving the Windows prompt, then open the POS app.",
          "In POS settings → Staff access, an authorized manager creates an active POS ID and passcode and selects Allowed actions. Sign into the POS app with those credentials.",
          "Alternatively choose Run Portable in browser. Confirm the salon, then check the sync indicator before daily work. Internet is required for sign-in and syncing."
        ],
        "check": "The correct salon opens and the POS ID can perform only its allowed actions.",
        "example": "A reception POS ID can be limited to the actions needed at the desk; the owner keeps a separate personal management account.",
        "issues": [
          "Windows download unavailable: use the offered browser option or contact support. The Windows installer is not an iPad application.",
          "Do not clear browser/app data or reinstall while tickets are waiting to sync. Keep the same device and review the sync status first."
        ]
      },
      {
        "id": "pair-customer-display",
        "title": "Pair a separate customer display",
        "steps": [
          "Ensure an active POS ID exists. In POS settings → Customer Display, use Setup QR or Install App on the intended display device.",
          "On iPad, open the setup link in Safari and pair with the salon POS ID and passcode. Keep the setup link and credentials private.",
          "After pairing, use Safari → Share → Add to Home Screen when offered. Reopen the saved icon and verify the salon and an authorized example ticket."
        ],
        "check": "The display shows the intended salon and the current customer-facing ticket information.",
        "example": "The receptionist uses Windows POS while the customer sees a separate iPad display. Staff Daily stays on the staff member’s private device.",
        "issues": [
          "No active POS ID or pairing unavailable: resolve the message in POS settings before retrying. Do not use an owner’s signed-in payroll page as a customer display."
        ]
      }
    ]
  },
  {
    "slug": "check-in-and-checkout",
    "title": "Staff check-in and ticket checkout",
    "summary": "Record staff attendance and complete the correct customer ticket.",
    "roles": [
      "owner",
      "staff"
    ],
    "entry": {
      "href": "/pos",
      "label": "Open POS"
    },
    "prerequisite": "Use the correct salon and a POS account or device with permission to manage the ticket.",
    "steps": [
      {
        "title": "Use staff check-in correctly",
        "body": "POS Check-in is for staff attendance. Select the intended staff member and the available attendance action, enter the staff passcode when requested, then Confirm. Customer arrivals and customer tickets use their booking or POS workflow, not this staff check-in screen."
      },
      {
        "title": "Review the ticket",
        "body": "Open the ticket and check services, staff, quantities, prices and any adjustments before completing it."
      },
      {
        "title": "Record the correct payment",
        "body": "On the ticket detail page, Payments → Add Payment records the selected Method and Amount. For an external card terminal, verify the transaction there first. Once the ticket meets checkout requirements, including full payment, use Checkout and check the result."
      },
      {
        "title": "Confirm completion before retrying",
        "body": "Check that the ticket has closed and the recorded payment matches the actual payment. If the response is slow, inspect the ticket and terminal result before attempting another charge or payment entry."
      }
    ],
    "notes": [
      "This guide does not describe an integrated card terminal. Recording a card payment in POS is not proof that an external terminal charged the card."
    ],
    "evidence": {
      "sourceFiles": [
        "app/check-in/[entry]/page.tsx",
        "app/(app)/pos/(workspace)/check-in/page.tsx",
        "app/(app)/pos/(workspace)/ticket/page.tsx",
        "app/(app)/pos-tickets/[ticketId]/page.tsx"
      ],
      "sourceReviewed": true,
      "screenshots": [
        {
          "id": "check-in",
          "caption": "Staff Check-in: attendance, not customer arrival",
          "alt": "Mockup of staff attendance with a sample employee, Check in, staff Passcode and Confirm.",
          "provenance": "source-grounded-simulation",
          "status": "illustrated",
          "desktop": {
            "src": "/help/2026-10-15/check-in-desktop.jpg",
            "width": 1440,
            "height": 900
          },
          "mobile": {
            "src": "/help/2026-10-15/check-in-mobile.jpg",
            "width": 390,
            "height": 844
          }
        },
        {
          "id": "checkout",
          "caption": "Ticket detail: Add Payment, then Checkout when eligible",
          "alt": "Mockup of the ticket detail payment form with Method, Amount, Add Payment and Checkout.",
          "provenance": "source-grounded-simulation",
          "status": "illustrated",
          "desktop": {
            "src": "/help/2026-10-15/checkout-desktop.jpg",
            "width": 1440,
            "height": 939
          },
          "mobile": {
            "src": "/help/2026-10-15/checkout-mobile.jpg",
            "width": 390,
            "height": 982
          }
        }
      ],
      "productionFlowVerified": false
    },
    "sections": [
      {
        "id": "ticket-payment",
        "title": "Review services, staff and an external card payment",
        "steps": [
          "Open the correct ticket. Under Services, use Add service to ticket → Add Item, then check each line’s assigned staff, quantity and price. Save any allowed edits before payment.",
          "Review discount, tax and tip controls if applicable. Check the final amount with the customer; a tip is separate from the service price.",
          "For an external card terminal, charge on that terminal and confirm success there. In the ticket detail page, open Payments, select the matching Method and Amount and choose Add Payment.",
          "For multiple actual payments, add a separate payment entry for each method and amount on the ticket detail page. Confirm the remaining balance before Checkout.",
          "Use Checkout only when its requirements are satisfied. Confirm the ticket is closed and inspect its payment entries before leaving the screen."
        ],
        "check": "Ticket total, recorded payments and the actual cash/terminal transactions agree.",
        "example": "A $50 service plus a $10 tip totals $60 before any other charges. If $20 was cash and $40 was charged successfully on the terminal, record $20 Cash and $40 Credit Card, not two $60 payments.",
        "issues": [
          "A POS card entry records payment; it does not itself charge the external terminal. If the terminal timed out, check its transaction history before charging again.",
          "Wrong amount or method after closing: use the permitted correction workflow or ask the owner. Do not create another sale to cancel the first one."
        ]
      }
    ]
  },
  {
  "slug": "payroll-and-tax",
  "title": "Review payroll, commission and tax records",
  "summary": "Review live income, change notes and recorded payment evidence.",
  "roles": [
    "owner"
  ],
  "entry": {
    "href": "/payroll",
    "label": "Open Payroll"
  },
  "prerequisite": "Payroll sections and edits depend on your access. Some export or Tax Company tools require additional setup or a plugin.",
  "steps": [
    {
      "title": "Review the current calculation",
      "body": "Select the salon and period. Payroll uses current services, tips, assignments and effective settings, including historical periods. Compare the underlying source records."
    },
    {
      "title": "Read the change note and history",
      "body": "Open Change history to inspect who changed a value, when it changed and its before/after values. Read staff input notes and review the affected business dates."
    },
    {
      "title": "Keep payment evidence separate",
      "body": "Calculated cash and check amounts are amounts due, not proof of payment. Open Recorded payments and adjustment evidence to export the original records, dates, actors and notes. Unavailable history does not mean zero paid."
    },
    {
      "title": "Reconcile live reports and exports",
      "body": "Tax Company and downloads use the current calculation. Verify legal names, tax settings and the source period. Historical statements and recorded payments remain separate evidence and are not silently rewritten by recalculation."
    }
  ],
  "notes": [
    "Tax Company and downloads use the current calculation. Verify legal names, tax settings and the source period. Historical statements and recorded payments remain separate evidence and are not silently rewritten by recalculation.",
    "Payroll records do not transfer money or file or pay taxes. Staff can view only the payroll for their authorized linked identity."
  ],
  "evidence": {
    "sourceFiles": [
      "app/(app)/payroll/page.tsx",
      "app/payroll/payroll-change-history.tsx",
      "app/payroll/payroll-recorded-facts.tsx",
      "lib/payroll.ts",
      "lib/payroll-records.ts"
    ],
    "sourceReviewed": true,
    "screenshots": [],
    "productionFlowVerified": false
  },
  "sections": [
    {
      "id": "commission-review",
      "title": "Reconcile live income with payment evidence",
      "steps": [
        "Select the salon and period. Payroll uses current services, tips, assignments and effective settings, including historical periods. Compare the underlying source records.",
        "Open Change history to inspect who changed a value, when it changed and its before/after values. Read staff input notes and review the affected business dates.",
        "Calculated cash and check amounts are amounts due, not proof of payment. Open Recorded payments and adjustment evidence to export the original records, dates, actors and notes. Unavailable history does not mean zero paid.",
        "Tax Company and downloads use the current calculation. Verify legal names, tax settings and the source period. Historical statements and recorded payments remain separate evidence and are not silently rewritten by recalculation."
      ],
      "check": "The live calculation agrees with current source data; change notes explain updates and actual payment evidence is reviewed separately.",
      "example": "A period previously calculated at $500 can show $600 after a valid source correction. A recorded $500 payment stays $500 with its original payment date and note; recalculation does not transfer another $100.",
      "issues": [
        "If a save is not confirmed, check the saved result before retrying. Do not create a second payment to work around a pending result.",
        "Payroll records do not transfer money or file or pay taxes. Staff can view only the payroll for their authorized linked identity."
      ]
    }
  ]
},
  {
    "slug": "reports-and-mobile",
    "title": "Review reports and manage remotely",
    "summary": "Check salon activity from a phone or desktop using the same salon context.",
    "roles": [
      "owner"
    ],
    "entry": {
      "href": "/reports",
      "label": "Open Reports"
    },
    "prerequisite": "Reports require the relevant permissions. A locked report can restrict edits or require a correction workflow.",
    "steps": [
      {
        "title": "Check the salon and date",
        "body": "Open Reports or the POS report workspace, then confirm the salon and reporting day or period before comparing totals."
      },
      {
        "title": "Reconcile before closing",
        "body": "Compare ticket and payment records with the actual cash and external payment results. Review the close or correction controls available to your role."
      },
      {
        "title": "Use the mobile workspace",
        "body": "On a phone, open the same salon to review bookings, Today and reports. If information looks stale, reload and check the selected salon and date before taking action."
      }
    ],
    "notes": [],
    "evidence": {
      "sourceFiles": [
        "app/(app)/reports/page.tsx",
        "app/(app)/pos/(workspace)/report/page.tsx",
        "app/(app)/staff/today/page.tsx",
        "app/pos/portable/report/portable-report-closing-form.tsx"
      ],
      "sourceReviewed": true,
      "screenshots": [
        {
          "id": "reports",
          "caption": "Compare payment records with actual receipts",
          "alt": "Explanatory comparison of sample cash and external card payment records, with a total of 520 dollars.",
          "provenance": "source-grounded-simulation",
          "status": "illustrated",
          "desktop": {
            "src": "/help/2026-10-15/reports-desktop.jpg",
            "width": 1440,
            "height": 1061
          },
          "mobile": {
            "src": "/help/2026-10-15/reports-mobile.jpg",
            "width": 390,
            "height": 1184
          }
        }
      ],
      "productionFlowVerified": false
    },
    "sections": [
      {
        "id": "close-business-day",
        "title": "Enter actual collections and reconcile the day",
        "steps": [
          "Open POS → Report and select the business date. Check that saved tickets have synced; pending uploads can make the report incomplete.",
          "In Closing Inputs, enter actual Cash, Credit Card and Other collections for that date. Use the terminal’s matching business-day transactions for card collections, not an unrelated bank payout.",
          "Review Actual Total, Expected total and Difference in Reconciliation. Record an explanation in Note when something needs checking, then choose Save.",
          "Wait for Saved and reopen the same date to verify the entries. If the date is locked, follow the main report correction workflow available to your role."
        ],
        "check": "Saved closing amounts remain after reload, and any difference has been investigated rather than hidden by changing a sale.",
        "example": "Expected total is $520. Actual Cash $220, Credit Card $300 and Other $0 give Actual Total $520 and Difference $0. Opening cash kept in the drawer is not new sales collected today.",
        "issues": [
          "Unsynced tickets: reconnect and review the sync indicator before final comparison. A local draft is not the saved report.",
          "Closing amounts changed on another screen: review Use saved amounts and Keep my entries for review. Compare values before saving again.",
          "Card fees, refunds and settlement timing can make a bank deposit different from gross terminal collections. Review the terminal statement separately."
        ]
      },
      {
        "id": "owner-remote",
        "title": "Review the salon from your phone",
        "steps": [
          "Sign in with your Owner account and select the salon in My place. Open Bookings, Today or Reports for the task you need.",
          "Check the business date, period and status filters before comparing numbers with the reception POS. Open a specific booking or ticket to investigate a difference.",
          "If a view looks old, reload and confirm the POS has synced. Ask the person at the salon to verify physical cash or an external terminal result when needed."
        ],
        "check": "The same salon and date show consistent saved records across devices.",
        "example": "The owner checks today’s card entries on a phone, then compares them with the receptionist’s terminal report for that same date.",
        "issues": [
          "A remote report cannot confirm how much cash is physically in the drawer or whether an external terminal actually charged a card."
        ]
      }
    ]
  },
  {
    "slug": "profiles-and-posts",
    "title": "Share profiles, posts and booking links",
    "summary": "Present your work and guide customers to an available booking flow.",
    "roles": [
      "owner",
      "staff",
      "customer"
    ],
    "entry": {
      "href": "/beauty",
      "label": "Open your beauty profile"
    },
    "prerequisite": "Profile editing and salon publishing depend on the account, salon connection and permissions.",
    "steps": [
      {
        "title": "Review the profile",
        "body": "Review your personal beauty profile or the salon profile you manage. Check public names, images and the team shown to customers."
      },
      {
        "title": "Publish only permitted content",
        "body": "Use the post tools available to your account. Obtain permission for customer photos and review any salon publication approval requested by the app."
      },
      {
        "title": "Check the shared link",
        "body": "Open the public profile and its available booking link to confirm the correct salon, service or staff context. A shared post does not itself confirm an appointment."
      }
    ],
    "notes": [],
    "evidence": {
      "sourceFiles": [
        "app/(app)/beauty/page.tsx",
        "app/(app)/salon-profile/page.tsx",
        "app/(app)/explore/beauty/[profileId]/page.tsx",
        "app/beauty/beauty-profile-client.tsx"
      ],
      "sourceReviewed": true,
      "screenshots": [
        {
          "id": "beauty-profile",
          "caption": "Review your beauty profile",
          "alt": "Illustrative beauty profile with sample color swatches and guidance to review public names and photo permission.",
          "provenance": "source-grounded-simulation",
          "status": "illustrated",
          "desktop": {
            "src": "/help/2026-10-15/beauty-profile-desktop.jpg",
            "width": 1440,
            "height": 900
          },
          "mobile": {
            "src": "/help/2026-10-15/beauty-profile-mobile.jpg",
            "width": 390,
            "height": 954
          }
        },
        {
          "id": "salon-profile",
          "caption": "Review the public salon profile",
          "alt": "Illustrative Drayko Demo public team with two sample staff profiles and online-booking eligibility guidance.",
          "provenance": "source-grounded-simulation",
          "status": "illustrated",
          "desktop": {
            "src": "/help/2026-10-15/salon-profile-desktop.jpg",
            "width": 1440,
            "height": 900
          },
          "mobile": {
            "src": "/help/2026-10-15/salon-profile-mobile.jpg",
            "width": 390,
            "height": 844
          }
        }
      ],
      "productionFlowVerified": false
    },
    "sections": [
      {
        "id": "beauty-post",
        "title": "Edit a profile and publish a post",
        "steps": [
          "Open your Beauty page and use Edit profile for your public profile information. Review the visible name, bio and photos before saving.",
          "Open the post composer. Choose Photo or Before & After, add the requested images and write a Caption. Use only images you have permission to publish.",
          "If you attribute the work to a salon, check the recent visit suggestion or use Choose another salon. Verify the Salon and Professional before submitting.",
          "Wait for the publishing result, then review My posts and the public view. A Before & After post can still show pending salon approval or visit verification."
        ],
        "check": "The intended photos, caption and attribution appear, with the actual approval status shown.",
        "example": "Mai posts two permitted nail photos as Before & After and selects Drayko Demo. Pending salon approval does not mean the salon has endorsed the post.",
        "issues": [
          "An upload or publish is still running: wait for its result before closing or posting again. If it fails, check My posts before retrying.",
          "Sharing a profile or post does not book an appointment; customers must complete the Book flow separately."
        ]
      }
    ]
  },
  {
    "slug": "troubleshooting",
    "title": "Get unstuck and contact support",
    "summary": "Check the account, salon and result before repeating an action.",
    "roles": [
      "customer",
      "owner",
      "staff"
    ],
    "entry": {
      "href": "/support",
      "label": "Open Help & support"
    },
    "prerequisite": "Keep the exact error message, page, approximate time and the action you attempted. Do not send passwords or verification codes.",
    "steps": [
      {
        "title": "Check the context",
        "body": "Confirm the signed-in account and selected salon. Staff need an active linked profile; owners and managers need the relevant permissions for each tool."
      },
      {
        "title": "Check whether the action completed",
        "body": "After a slow or failed booking response, check My bookings or the salon booking list before submitting again. If salon lookup fails, avoid creating duplicate listings."
      },
      {
        "title": "Continue through support",
        "body": "Use Help & support or the help control on the affected screen. Include the error and expected result; hide customer contact details, financial records and private setup links in any image you share."
      }
    ],
    "notes": [
      "Assigned staff can see the customer name and full phone number in appointment details. Customer suggestions may also expose same-salon names and phones when staff booking creation is enabled. Use this information only for authorized salon work."
    ],
    "evidence": {
      "sourceFiles": [
        "app/(app)/support/page.tsx",
        "components/contextual-support.tsx",
        "app/(app)/staff/appointments/page.tsx",
        "supabase/migrations/202610020007_staff_booking_customer_suggestions.sql"
      ],
      "sourceReviewed": true,
      "screenshots": [
        {
          "id": "support",
          "caption": "Send a useful support request",
          "alt": "Demo support screen with an example issue and no customer or private account records.",
          "provenance": "source-grounded-simulation",
          "status": "illustrated",
          "desktop": {
            "src": "/help/2026-10-15/support-desktop.jpg",
            "width": 1440,
            "height": 900
          },
          "mobile": {
            "src": "/help/2026-10-15/support-mobile.jpg",
            "width": 390,
            "height": 844
          }
        }
      ],
      "productionFlowVerified": false
    },
    "sections": [
      {
        "id": "triage",
        "title": "Find the cause before repeating an action",
        "steps": [
          "Check account, salon, date and permissions first. For a staff portal, confirm the active linked staff profile; for a POS device, confirm its POS ID and allowed actions.",
          "Check the saved outcome: booking list for an appointment, ticket/payment entries for checkout, My Applications for a connection and the saved period for payroll.",
          "For device sync problems, keep the device data, reconnect and inspect the sync indicator. For conflicting edits, compare the latest saved record before choosing which values to keep.",
          "Open Help & support from the affected screen. Include the task, page, time, exact error and what you expected. Hide private contact, payroll and setup-link information in screenshots."
        ],
        "check": "Support receives enough context to locate the failed step without passwords, codes or unrelated private records.",
        "example": "Useful report: “Create Salon → Drayko Demo → Could not check existing salons, around 10:15; no salon appeared afterward.”",
        "issues": [
          "Do not repeatedly charge a card, create duplicate salons or submit the same booking while the original outcome is uncertain."
        ]
      }
    ]
  }
];
export const HELP_QUICK_STARTS: readonly {id: HelpRole; title: string; summary: string; slugs: string[]}[] = [
  {
    "id": "customer",
    "title": "I am a customer",
    "summary": "Find a salon and manage an appointment.",
    "slugs": [
      "account",
      "find-and-book",
      "troubleshooting"
    ]
  },
  {
    "id": "owner",
    "title": "I manage a salon",
    "summary": "Set up your salon, then run its daily work.",
    "slugs": [
      "open-or-claim",
      "booking-setup",
      "owner-tips"
    ]
  },
  {
    "id": "staff",
    "title": "I work at a salon",
    "summary": "Connect your account and open your own work area.",
    "slugs": [
      "staff-connections",
      "check-in-and-checkout",
      "troubleshooting"
    ]
  }
];
export function findHelpGuide(slug: string): HelpGuide | undefined { return HELP_GUIDES.find(guide => guide.slug === slug); }
