import {
  LEGAL_EFFECTIVE_DATE,
  LEGAL_LAST_UPDATED,
  REYLUMI_APP_NAME,
} from "@/lib/reylumi-config";
import type { Metadata } from "next";

export type LegalInline =
  | string
  | {
      text: string;
      type: "strong";
    }
  | {
      href: string;
      text: string;
      type: "link";
    };

export type LegalRichText = readonly LegalInline[];

export type LegalBlock =
  | {
      content: LegalRichText;
      type: "paragraph";
    }
  | {
      items: readonly LegalRichText[];
      type: "list";
    }
  | {
      content: LegalRichText;
      title?: string;
      type: "note";
    }
  | {
      text: string;
      type: "subheading";
    };

export type LegalSection = {
  blocks: readonly LegalBlock[];
  id: string;
  title: string;
};

export type LegalDocument = {
  description: string;
  href: string;
  intro: string;
  lastUpdated?: string;
  sections: readonly LegalSection[];
  shortTitle: string;
  title: string;
};

export type LegalPolicyCard = {
  description: string;
  href: string;
  label: string;
};

export type LegalPolicyGroup = {
  id: string;
  policies: readonly LegalPolicyCard[];
  title: string;
};

export const LEGAL_DATES = {
  effective: LEGAL_EFFECTIVE_DATE,
  lastUpdated: LEGAL_LAST_UPDATED,
} as const;

// Local review candidate. Publication still requires verified provider/data-role
// disclosures, retention and deletion behavior, support operations, applicable
// privacy/children's requirements, and owner review of the complete policy set.
// No new liability cap, arbitration agreement, or DMCA registration is asserted.

function strong(text: string): LegalInline {
  return { text, type: "strong" };
}

function link(text: string, href: string): LegalInline {
  return { href, text, type: "link" };
}

function paragraph(...content: LegalInline[]): LegalBlock {
  return { content, type: "paragraph" };
}

function item(...content: LegalInline[]): LegalRichText {
  return content;
}

function list(...items: LegalRichText[]): LegalBlock {
  return { items, type: "list" };
}

function note(title: string, ...content: LegalInline[]): LegalBlock {
  return { content, title, type: "note" };
}

function subheading(text: string): LegalBlock {
  return { text, type: "subheading" };
}

const termsSections: LegalSection[] = [
  {
    id: "introduction",
    title: "Introduction",
    blocks: [
      paragraph(
        strong(REYLUMI_APP_NAME),
        " is operated by Reylumi LLC and provides technology for beauty discovery, booking, customer history, salon operations, POS records, staff workflows, payroll support, tax-related operational records, public content, and related account experiences. These Terms explain the rules for using ReyLUMI as a client, beauty professional, staff member, salon owner, or business user.",
      ),
      paragraph(
        "The ReyLUMI iOS app is free to download and use in the United States. This does not make salon services or separately identified products and services free. Prices and any additional terms for those offerings apply where they are offered.",
      ),
      paragraph(
        "A person may use ReyLUMI in more than one way. For example, someone may have a personal profile, book services as a client, work as staff at a salon, and help manage a business workspace. Your rights and responsibilities can depend on the context in which you are using the platform.",
      ),
      paragraph(
        "These Terms work together with the ",
        link("Privacy Policy", "/privacy"),
        ", ",
        link("Community Standards", "/community"),
        ", and ",
        link("Business & Salon Terms", "/business-terms"),
        ". If you use ReyLUMI for a salon or business, the business-specific terms also apply to that use.",
      ),
    ],
  },
  {
    id: "acceptance",
    title: "Acceptance of Terms",
    blocks: [
      paragraph(
        "By creating an account, accessing ReyLUMI, booking through the platform, publishing content, accepting a staff invitation, or using a business workspace, you agree to these Terms and the policies linked from them.",
      ),
      paragraph(
        "If you use ReyLUMI on behalf of a salon, business, or staff team, you represent that you have authority to use that workspace and to accept applicable terms for that use. If your authority changes, you should stop using that business workspace until your access is updated.",
      ),
      paragraph(
        "Some features may present additional terms, notices, or confirmations. Those terms apply to the feature they describe, but they do not replace these Terms unless they expressly say so.",
      ),
      paragraph(
        "Agreement to these Terms is not blanket consent to every use or disclosure of personal information. A permission to manage a workspace or submit a record does not replace a notice, consent, or other authorization required for the particular information and purpose. Displaying this policy alone does not establish that a required consent has been obtained.",
      ),
    ],
  },
  {
    id: "eligibility",
    title: "Eligibility",
    blocks: [
      paragraph(
        "You must be able to form a legally binding agreement, or use ReyLUMI with appropriate consent where required by law. You may not use the platform if applicable law prohibits you from doing so.",
      ),
      paragraph(
        "These Terms do not set a universal minimum age. Particular features, laws, or platform requirements may require additional age-related protections or parent or guardian involvement. Appropriate consent to use a feature does not replace any notice, parental consent, or other safeguard required before collecting a child's personal information.",
      ),
      paragraph(
        "Business users are responsible for confirming that their salon, services, staff relationships, licenses, customer communications, prices, taxes, and professional obligations comply with laws and rules that apply to them.",
      ),
      paragraph(
        "ReyLUMI may limit access where it reasonably believes an account, workspace, or activity creates safety, legal, security, fraud, or authorization concerns.",
      ),
    ],
  },
  {
    id: "accounts-and-roles",
    title: "Accounts and Roles",
    blocks: [
      paragraph(
        "ReyLUMI supports personal accounts and business-related roles such as Owner, manager, staff, and service professional. Access may vary by workspace, role, invitation, membership, salon relationship, and platform authorization.",
      ),
      paragraph(
        "A role shown in the interface is not a substitute for authorization. Permissions must come from the account, salon, invitation, membership, or other access records that control the workspace. See ",
        link("Business & Salon Terms", "/business-terms#permissions-access"),
        " for more detail on business permissions.",
      ),
      paragraph(
        "You should not share credentials, impersonate another user, or use another person's workspace access. If you believe an account or workspace was accessed without permission, report it promptly.",
      ),
    ],
  },
  {
    id: "account-responsibility",
    title: "Account Responsibility",
    blocks: [
      paragraph(
        "You are responsible for keeping account credentials secure, maintaining accurate contact information, and using ReyLUMI only for lawful and authorized purposes.",
      ),
      paragraph(
        "You are responsible for your authorized use of an account or business workspace and for people you authorize to act for you, to the extent permitted by law. If you supervise a salon workspace, review staff access regularly and remove users who no longer need access. These responsibilities do not excuse unauthorized access caused by a defect in ReyLUMI's own processing or security practices.",
      ),
      paragraph(
        "If ReyLUMI provides account recovery, phone verification, staff invitation, or similar identity workflows, you must provide accurate information and may not use those workflows to take over someone else's account, customer history, or business relationship.",
      ),
    ],
  },
  {
    id: "platform-role",
    title: "Platform Role",
    blocks: [
      paragraph(
        "ReyLUMI is a technology platform. It helps users discover salons, connect with beauty professionals, request bookings, manage salon operations, maintain records, and perform operational calculations based on information entered into the platform.",
      ),
      paragraph(
        "ReyLUMI does not automatically become a salon, beauty service provider, employer, accountant, tax advisor, law firm, payroll provider, or payment processor merely because those workflows are supported or recorded in the product.",
      ),
      paragraph(
        "Salons, professionals, staff, and clients remain responsible for the real-world services, employment relationships, business decisions, financial decisions, and legal obligations that belong to them.",
      ),
    ],
  },
  {
    id: "user-inputs-outputs",
    title: "User Inputs and Outputs",
    blocks: [
      paragraph(
        "Many ReyLUMI outputs depend on information entered by users or configured by a salon. This can include service prices, staff assignments, booking settings, POS ticket lines, discounts, tips, tax settings, payroll settings, commission rules, customer records, and other operational inputs.",
      ),
      paragraph(
        "You must have the rights, authority, and permissions needed to submit information, choose its recipients, and use the requested feature. This includes appropriate rights and permissions for another person's photograph, likeness, work, customer information, staff information, or confidential records. Authority to manage a salon is not permission to publish every record in its workspace.",
      ),
      paragraph(
        "Because outputs depend on those inputs, users and businesses should review important results before relying on them. This is especially important before paying staff, filing taxes, issuing refunds, correcting tickets, publishing salon information, or making financial or business decisions.",
      ),
      paragraph(
        "Provide accurate information to the best of your knowledge, correct information you control, and promptly report errors or suspected unauthorized use. These duties concern your conduct and inputs. They do not remove ReyLUMI's obligations for its own calculations, processing, security practices, representations, or other conduct, or waive any right or remedy that cannot lawfully be waived.",
      ),
      paragraph(
        "ReyLUMI works to provide useful tools, but it cannot guarantee that every user-entered value, configuration, calculation, or record is complete, current, or suitable for every legal, tax, payroll, or accounting purpose.",
      ),
    ],
  },
  {
    id: "booking",
    title: "Booking",
    blocks: [
      paragraph(
        "ReyLUMI is a platform that connects clients with salons, beauty professionals, and businesses. ReyLUMI facilitates technology for discovery, booking requests, schedule visibility, booking status, and related communication; it is not the provider of the beauty service unless expressly stated otherwise.",
      ),
      paragraph(
        "A booking may require confirmation before it is accepted. Availability shown in a booking experience does not guarantee that a provider will accept the request, that a specific professional will be available, or that a service can be performed exactly as requested.",
      ),
      list(
        item(
          strong("Salon and provider responsibility."),
          " Availability, pricing, service details, staff assignment, professional licensing, service quality, and salon readiness are the responsibility of the business or service provider.",
        ),
        item(
          strong("Cancellation and no-show rules."),
          " A salon may set cancellation, late cancellation, or no-show rules, but those rules should be displayed before they are applied and must comply with applicable law.",
        ),
        item(
          strong("Service disputes."),
          " Service quality disputes should first be handled between the client and the provider because the provider controls the service experience.",
        ),
      ),
      paragraph(
        "Reviews about a booking should follow the ",
        link("Community Standards for reviews", "/community#reviews"),
        ". Business responsibilities for honoring accepted bookings are described in the ",
        link("Business & Salon Terms", "/business-terms#booking-responsibility"),
        ".",
      ),
    ],
  },
  {
    id: "payments",
    title: "Payments and Refunds",
    blocks: [
      paragraph(
        "A free app download is separate from a paid Market feature, subscription, sponsored placement, or advertising-credit purchase where offered. Those transactions can have their own price, billing interval, renewal, cancellation, and refund terms. Review the terms for the actual offer and checkout. These Terms do not remove a refund or cancellation right protected by applicable law.",
      ),
      paragraph(
        "ReyLUMI may help record payment-related information, such as amounts, methods, tips, discounts, taxes, deposits, refunds, and adjustments, including POS workflows where enabled. Unless a separate checkout or payment-processing integration expressly says otherwise, ReyLUMI's current POS payment records are operational records and do not by themselves process or settle payment.",
      ),
      paragraph(
        "Refund and cancellation outcomes depend on the applicable salon policy, any payment processor actually used for the transaction, and applicable law. These Terms do not create a universal refund rule unless ReyLUMI presents one in a specific checkout, booking, or business agreement.",
      ),
      paragraph(
        "For an advertising-credit purchase, Support reviews refund requests individually under the terms of the actual purchase and applicable law. Canceling or stopping a campaign returns eligible unused campaign credits to the advertising balance; it does not automatically refund a payment to a card or other payment method. A return of credits to the balance and a cash refund are separate outcomes. Contact ",
        link("Support", "/contact-support"),
        " if you want a purchase reviewed. This review process does not restrict a refund right protected by applicable law.",
      ),
      paragraph(
        "If third-party payment processing is enabled for a transaction, additional processor terms, fees, settlement timelines, chargeback rules, and verification requirements may apply. Salons should review ",
        link("POS Records", "/business-terms#pos-records"),
        " and ",
        link("Payments", "/business-terms#payments"),
        " in the Business & Salon Terms before relying on payment records.",
      ),
    ],
  },
  {
    id: "third-party-services",
    title: "Third-Party Services",
    blocks: [
      paragraph(
        "The platform may rely on third-party services for hosting, database, authentication, storage, email, maps, payment processing where enabled, or similar operations. These services can affect account access, file delivery, map display, password recovery, booking communications, and other product behavior.",
      ),
      paragraph(
        "ReyLUMI works to choose appropriate providers and operate the platform responsibly, but ReyLUMI does not guarantee that every third-party service will be uninterrupted, error-free, or available in every location at all times.",
      ),
      paragraph(
        "You may need to follow third-party terms when you use a feature that depends on an outside provider. Privacy disclosures about service providers are described in the ",
        link("Service Providers", "/privacy#service-providers"),
        " section of the Privacy Policy.",
      ),
    ],
  },
  {
    id: "prohibited-use",
    title: "Prohibited Use",
    blocks: [
      paragraph(
        "You may not misuse ReyLUMI, interfere with the platform, or use the platform to harm other people, businesses, or systems.",
      ),
      list(
        item("Do not use the platform to break the law, mislead clients, or impersonate another person, salon, staff member, business, or brand."),
        item("Do not attempt to bypass authentication, permissions, rate limits, workspace boundaries, invitation controls, or security measures."),
        item("Do not upload malicious code, spam, abusive content, illegal content, or content that violates another person's privacy or intellectual property rights."),
        item("Do not scrape, reverse engineer, or misuse platform data except where allowed by law or written permission."),
        item("Do not manipulate bookings, reviews, verified visits, payroll records, POS records, identity claims, or business permissions."),
      ),
    ],
  },
  {
    id: "intellectual-property",
    title: "Intellectual Property",
    blocks: [
      paragraph(
        "Reylumi LLC and its licensors retain their rights in the platform software, original designs, branding, and other platform materials. A platform copyright notice does not claim ownership of user submissions. You may not copy, modify, distribute, reverse engineer, or misuse platform materials except as allowed by these Terms, product functionality, applicable law, or written permission.",
      ),
      paragraph(
        "You and other existing rights holders retain the rights you have in submitted content and information, including photos, videos, reviews, profiles, salon content, and business records. Uploading material does not transfer ownership to ReyLUMI or give you ownership of someone else's material. To provide the features you request, you grant ReyLUMI a non-exclusive, royalty-free license to host, store, reproduce, technically format, deliver, and display your submissions to the audience permitted by the feature and available settings, consistent with the ",
        link("Privacy Policy", "/privacy"),
        ". ReyLUMI may perform those activities through service providers for the applicable service purposes.",
      ),
      paragraph(
        "This license is limited to processing reasonably necessary to operate, secure, maintain, and support the requested service and comply with applicable law. It does not make private workspace records, payroll information, tax documents, or drafts public. It does not grant permission for unrelated public promotion, sale, or AI-model training. Any use beyond this service scope needs a separate lawful basis and any required notice or permission.",
      ),
      paragraph(
        "The license applies while the content is provided through the service and, after removal, only to the extent needed for lawful retention, security or dispute obligations, and authorized copies that remain as described in the Privacy Policy. It does not authorize indefinite retention without a continuing lawful purpose. Deleting a submission cannot by itself recall copies already lawfully received or shared by others.",
      ),
      paragraph(
        "If you publish content publicly, such as public salon profile content, reviews, or beauty profile content, other users may be able to view it, interact with it, or use it to decide whether to book or work with a salon.",
      ),
      paragraph(
        "Only submit content you own or are otherwise entitled to use. To raise a rights concern, use ",
        link("Contact Support", "/contact-support"),
        " and identify the material, its location in ReyLUMI, the rights involved, your authority to report, and a way to contact you. Rights complaints, privacy reports, and safety reports may require different information. These Terms do not require users to transfer copyright in an honest review or prevent lawful criticism.",
      ),
    ],
  },
  {
    id: "ai-generated-images",
    title: "AI-Generated Reference Images (lumiAi)",
    blocks: [
      paragraph(
        "Images marked ",
        strong("lumiAi"),
        " are AI-generated reference images created by ReyLUMI for inspiration and illustration. These images may appear in Explore, style references, service guides, and placeholder imagery on business profiles.",
      ),
      paragraph(
        "A lumiAi image is not a photograph of actual work, clients, staff, or premises of the salon or professional shown nearby. Its placement does not mean that the business created the image, performed the illustrated work, or endorsed the design.",
      ),
      paragraph(
        "AI-generated images may contain unrealistic details. They do not guarantee that a design or service is available or that the same result can be achieved. Confirm the design, suitability, price, and availability directly with the salon or professional before booking.",
      ),
      paragraph(
        "Platform-produced lumiAi reference images are separate from user submissions. Their availability does not promise copyright protection for every AI-generated element or give users ownership of third-party material.",
      ),
    ],
  },
  {
    id: "suspension-termination",
    title: "Suspension and Termination",
    blocks: [
      paragraph(
        "We may suspend, limit, or terminate access when reasonably needed to protect users, investigate abuse, comply with law, address security concerns, resolve authorization disputes, or enforce these Terms.",
      ),
      paragraph(
        "Suspension can apply to a personal account, public content, a staff relationship, a business workspace, or a feature within a workspace, depending on the issue. ReyLUMI may preserve records where needed for security, dispute resolution, legal compliance, or business continuity.",
      ),
      paragraph(
        "You may stop using the platform at any time. Some records may remain as described in the ",
        link("Privacy Policy", "/privacy#data-retention"),
        " and ",
        link("Business & Salon Terms", "/business-terms#restricted-historical-data"),
        ".",
      ),
    ],
  },
  {
    id: "disclaimer",
    title: "Disclaimer",
    blocks: [
      paragraph(
        "ReyLUMI works to provide reliable and useful tools, but technology can contain errors, interruptions, delays, incomplete records, or configuration issues. The platform is provided on an as-available basis.",
      ),
      paragraph(
        "ReyLUMI does not guarantee uninterrupted operation, particular business results, provider quality, booking availability, customer demand, review outcomes, or that every record or calculation will be complete or error-free.",
      ),
      paragraph(
        "Users and businesses should verify important information before making service, financial, payroll, tax, employment, refund, or legal decisions.",
      ),
      paragraph(
        "ReyLUMI will use reasonable efforts to investigate reported technical issues and assist with available correction or recovery options. Assistance depends on authorization, available records, technical feasibility, and applicable law. This does not guarantee recovery of every file, correction of a third party's records, or a particular response deadline.",
      ),
    ],
  },
  {
    id: "limitation-liability",
    title: "Limitation of Liability",
    blocks: [
      paragraph(
        "Nothing in these Terms excludes or limits a right, remedy, or liability that applicable law does not permit to be excluded or limited. User responsibilities and duties to review information do not remove ReyLUMI's independent obligations for its own processing, security practices, representations, or other conduct.",
      ),
      paragraph(
        "To the maximum extent permitted by applicable law, ReyLUMI will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, lost revenue, lost goodwill, or loss of data.",
      ),
      paragraph(
        "The exclusions above apply only to the extent permitted by the law applicable to the claim. They do not override nonwaivable consumer protections or any support, privacy, or security obligation that cannot lawfully be limited. These Terms do not set a monetary liability cap or require users to indemnify ReyLUMI for every consequence of a platform error.",
      ),
    ],
  },
  {
    id: "changes",
    title: "Changes to Terms",
    blocks: [
      paragraph(
        "We may update these Terms as the product, law, or business needs change. The Last updated date shows when this document was most recently revised.",
      ),
      paragraph(
        "Material changes may require additional notice, consent, or effective-date timing where required by applicable law. Continued use of ReyLUMI after updated terms become effective means you accept the updated terms, unless applicable law requires a different process.",
      ),
    ],
  },
  {
    id: "governing-law",
    title: "Governing Law and Disputes",
    blocks: [
      paragraph(
        "Applicable law governs the rights and remedies available for a dispute. These Terms do not select an exclusive court or require arbitration, a jury waiver, or a class-action waiver.",
      ),
      paragraph(
        "You may contact ReyLUMI about an issue so it can be reviewed. Contacting support is not a condition for exercising a right or seeking a remedy that applicable law protects.",
      ),
    ],
  },
  {
    id: "contact",
    title: "Contact",
    blocks: [
      paragraph(
        "For questions about these Terms or Reylumi LLC's operation of ReyLUMI, use ",
        link("Contact Support", "/contact-support"),
        ", email ",
        link("support@reylumi.com", "mailto:support@reylumi.com"),
        ", or use the support feature in your account. Do not submit passwords, payment credentials, or other unnecessary confidential records with a general inquiry.",
      ),
    ],
  },
];

const privacySections: LegalSection[] = [
  {
    id: "introduction",
    title: "Introduction",
    blocks: [
      paragraph(
        "Reylumi LLC operates ReyLUMI. This Privacy Policy explains information handling for personal accounts, clients, beauty professionals, staff, salon owners, salon workspaces, business accounts, public discovery, community content, booking, POS, payroll, tax-related records, and document-sharing features.",
      ),
      paragraph(
        "A person may have more than one relationship with ReyLUMI. For example, you may book services as a client, maintain a beauty profile, work as staff at a salon, and help manage a business workspace. The information visible in each context depends on the relationship, the workspace, the feature being used, and the authorization controls that apply.",
      ),
      paragraph(
        "This policy describes categories of information ReyLUMI may handle when those workflows are used. It does not mean every category applies to every user, every salon, or every account.",
      ),
    ],
  },
  {
    id: "information-we-collect",
    title: "Information We Collect",
    blocks: [
      subheading("Where information comes from"),
      paragraph(
        "Information can come directly from you; from a salon, employer, staff member, client, tax professional, or other user authorized to use the relevant workflow; from your device and interactions with the service; and from providers that return authentication, payment, delivery, or other feature results. A salon may supply a customer or staff record even if that person has not created a ReyLUMI account. Public posts, private workspace records, and provider confirmations have different purposes and audiences.",
      ),
      subheading("Account and profile information"),
      paragraph(
        "When you create or use an account, ReyLUMI may collect account identifiers and profile information such as your name or display name, email address, phone number where provided or verified, profile photo or avatar, account status, login session information, and account preferences.",
      ),
      paragraph(
        "The platform may also create identifiers or records that connect your account to a personal profile, booking history, saved content, staff invitation, salon relationship, business workspace, or customer identity claim. These records help ReyLUMI route you to the correct experience and enforce access controls.",
      ),
      subheading("Beauty profile and public content"),
      paragraph(
        "If you use beauty profile, Explore, or public content features, ReyLUMI may handle information you choose to submit, such as profile details, photos, videos, before/after content, captions, posts, public salon content, comments, reviews, saved posts, and attribution or booking links connected to content.",
      ),
      paragraph(
        "Some content is intended to be public or discoverable. Public content may be visible to clients, salons, staff, beauty professionals, and other users depending on the feature and your selected visibility settings.",
      ),
      subheading("Salon and business information"),
      paragraph(
        "Salon and business workspaces may include salon names, business profile details, locations, branding, service catalogs, prices, durations, booking settings, availability rules, staff relationships, role memberships, permissions, customer communication settings, public profile content, and operational configuration.",
      ),
      subheading("Staff information"),
      paragraph(
        "Staff-related records may include a staff member's salon relationship, role, permissions, service assignments, availability, workday records, booking assignments, public staff profile information, passcode or access setup, connection requests, invitation status, and compensation-related operational data where payroll features are used.",
      ),
      paragraph(
        "Staff @ Salon is a salon-scoped relationship. A staff member may also have a personal account or public profile, but business access depends on the salon relationship and authorization for that workspace. See ",
        link("Business and Staff Data", "/privacy#business-staff-data"),
        " for more detail.",
      ),
      subheading("Customer and booking information"),
      paragraph(
        "Booking and customer records may include customer identity or contact details, requested services, assigned staff, appointment time, booking status, confirmation status, cancellation information, visit history, linked receipts, customer notes where supported by the product, salon-specific customer records, and customer account claim information.",
      ),
      subheading("POS and transaction records"),
      paragraph(
        "Where POS or ticket workflows are used, ReyLUMI may record tickets, services or items, staff attribution, discounts, tips, tax rates or tax amounts, payment method or payment notes, corrections, receipts, daily closing records, and related audit history. These are operational transaction records. Recording a payment method or amount in ReyLUMI does not by itself mean ReyLUMI processes, settles, or guarantees the payment.",
      ),
      subheading("Payroll and tax operational records"),
      paragraph(
        "Where payroll or tax workflows are used, records can include legal names, contact details, compensation settings, commissions, tips, bonuses, cash and check amounts, deductions, staff earnings, work or service attribution, payroll runs, paystubs, reported wages, taxable gross, withholding-related values, and reports. Tax profiles, messages, and uploaded PDF or image documents can contain Social Security numbers, EINs, tax forms, financial details, and other information supplied by the sender. Calling a record business data does not remove the privacy interests of the people it identifies.",
      ),
      paragraph(
        "Where bank or Check Writer features are used, records can include bank routing and account details, bank and issuer information, payee information, check amounts and numbers, memos, and generated files. An authorized server workflow can decrypt bank details to prepare a check PDF; encryption of stored fields does not mean those details are never accessible or processed. Use these features only with authority and do not place this information in public posts or ordinary support messages.",
      ),
      subheading("Purchases and payment-provider information"),
      paragraph(
        "Where payment features are used, ReyLUMI can handle order, subscription, transaction, account or salon identifiers, purchased products or credits, amounts, billing status, and payment-provider results. A payment provider may collect card or billing information through its own checkout. That does not mean ReyLUMI collects no financial information: the related transaction records and any bank details submitted to a separate Check Writer workflow are different data flows.",
      ),
      subheading("Location and maps"),
      paragraph(
        "If you allow a location feature to use your position, Explore can send GPS coordinates to ReyLUMI's server to identify your area. Area lookups and map display can involve external map or location providers and requests containing location or map-area information, IP addresses, and technical request details. Browser state can retain location-related information for reuse. A temporary cache is not a promise that every copy is deleted at a fixed time.",
      ),
      paragraph(
        "Location-related requests can include the coordinates returned by your device or an address or area you type. Some map resources are requested directly from your device, while other lookups pass through ReyLUMI's server. Opening an external directions link sends its destination to the maps service you open. You can decline device location access and use the available manual city, ZIP, or address search instead; a device permission does not authorize unrelated uses of location information.",
      ),
      subheading("Device, technical, and usage information"),
      paragraph(
        "ReyLUMI may process technical information needed to operate the app, such as cookies, browser storage preferences, selected workspace, saved Explore preferences, booking draft continuity, POS device preferences, authentication routing, request logs, browser or device details, and diagnostic information generated by normal app, auth, hosting, or browser workflows.",
      ),
      paragraph(
        "Security and login records can link an account or action with an IP address, user agent, approximate area derived from network information, session history, and a signed or hashed browser identifier. These records can still identify or distinguish a person or device even when a direct name is not included.",
      ),
      paragraph(
        "Sponsored-content features can record campaign and session identifiers, the page or entry path, time, device or audience categories, and interaction events such as views and clicks. Signup attribution can associate a campaign interaction with a newly created account. These records support campaign measurement and platform integrity; a session identifier or hashed value is not necessarily anonymous.",
      ),
    ],
  },
  {
    id: "how-we-use-information",
    title: "How We Use Information",
    blocks: [
      subheading("Provide and operate ReyLUMI"),
      paragraph(
        "ReyLUMI uses information to create accounts, authenticate users, maintain sessions, route users to the correct personal or business context, show relevant navigation, enforce permissions, and provide the product experiences users request.",
      ),
      subheading("Provide booking functionality"),
      paragraph(
        "Booking information is used to connect a client with a salon or beauty professional, identify requested services, show availability or booking settings, assign staff where applicable, update booking status, send or display booking-related information, and maintain booking history.",
      ),
      subheading("Support salon operations"),
      paragraph(
        "Salon and business information is used to help businesses manage services, staff relationships, schedules, customers, public profiles, tickets, receipts, reports, and other operational records. Owners and authorized staff may access business records according to their permissions and the needs of the workspace.",
      ),
      subheading("Perform operational calculations"),
      paragraph(
        "ReyLUMI may perform calculations for POS totals, discounts, tips, taxes, staff earnings, commission, payroll, tax-company views, or reports. These outputs depend on information entered by users, salon configuration, transaction records, staff or service attribution, and other applicable settings.",
      ),
      paragraph(
        "Businesses should review calculation outputs before paying staff, filing taxes, issuing refunds, correcting records, or making financial decisions. Related retention rules are described in ",
        link("Data Retention", "/privacy#data-retention"),
        ".",
      ),
      subheading("Maintain safety and integrity"),
      paragraph(
        "Information may be used to protect accounts, enforce authorization, investigate suspected abuse, detect fraud or scams, respond to security concerns, prevent misuse of identity or staff invitations, and enforce the ",
        link("Community Standards", "/community"),
        ".",
      ),
      subheading("Improve and troubleshoot the service"),
      paragraph(
        "Technical and diagnostic information may be used to investigate errors, improve reliability, debug product behavior, maintain performance, and understand whether features operate as intended.",
      ),
      paragraph(
        "Sponsored-content interaction and attribution information is used to measure campaign delivery and responses, associate eligible signups with campaigns, and investigate campaign misuse. Location and map information is used to find an area and display nearby or selected content when those features are used.",
      ),
      subheading("Meet legal and business obligations"),
      paragraph(
        "Information may be retained, preserved, disclosed, or used when needed to comply with applicable law, respond to lawful requests, resolve disputes, enforce agreements, maintain business records, support accounting or tax obligations, or protect the rights and safety of users and the platform.",
      ),
    ],
  },
  {
    id: "business-staff-data",
    title: "Business and Staff Data",
    blocks: [
      paragraph(
        "Business workspaces may include account membership, salon profile information, staff profile details, invitations, role assignments, permissions, service assignments, availability, POS access, payroll setup, paystub records, tax-company records, operational reports, and related audit or correction history.",
      ),
      paragraph(
        "For workspace features, salons and authorized business users decide which records to submit and whom to authorize within the feature. ReyLUMI processes those records to provide the requested tools, enforce access, support the service, and meet applicable obligations. ReyLUMI also uses information for its own account, community, security, and disclosed platform purposes. Responsibilities depend on the purpose and applicable law; storing records in a salon workspace does not transfer all privacy responsibility to the salon or make ReyLUMI only a processor for every use.",
      ),
      paragraph(
        strong("Staff @ Salon"),
        " is a relationship within a salon workspace. A staff member may have personal identity information in ReyLUMI, but business access is tied to the salon relationship and the authorization controls for that salon. A client-side role label alone does not decide access.",
      ),
      paragraph(
        "Owners and authorized users may access business and staff records when needed to manage the salon, schedule services, complete bookings, review POS activity, prepare payroll records, or comply with business obligations. Access should be limited to the permissions and legitimate business needs of the workspace.",
      ),
      paragraph(
        "Business users should review the ",
        link("Business & Salon Terms", "/business-terms#staff-relationships"),
        " for responsibilities related to staff relationships, classification, compensation, permissions, and workplace obligations.",
      ),
    ],
  },
  {
    id: "customer-booking-data",
    title: "Customer and Booking Data",
    blocks: [
      paragraph(
        "Customers provide information so a salon or professional can evaluate, confirm, and perform an appointment. This may include contact details, requested service, appointment time, selected salon, assigned professional, booking status, cancellation information, and service or visit history.",
      ),
      paragraph(
        "A salon or assigned professional may need access to booking details to prepare for the appointment, communicate with the client, provide the service, manage schedule changes, complete POS or receipt workflows, and maintain business records.",
      ),
      paragraph(
        "Booking data does not become public simply because a booking exists. Public display is limited to features intended for public content, such as public salon profiles, reviews, or user-submitted public posts. Reviews related to real service experiences are governed by ",
        link("Community Standards for reviews", "/community#reviews"),
        ".",
      ),
      paragraph(
        "Booking and customer records may be retained for customer service, business continuity, dispute resolution, accounting, audit, tax, and legal compliance. Closing a personal account does not necessarily remove records that a salon must retain. See ",
        link("Account Deletion", "/privacy#account-deletion"),
        ".",
      ),
    ],
  },
  {
    id: "device-usage-analytics",
    title: "Device / Usage / Analytics Data",
    blocks: [
      paragraph(
        "The app uses cookies and local browser storage for login sessions, selected workspace, authentication routing, saved preferences, booking draft continuity, POS device preferences, Explore preferences, and similar product behavior.",
      ),
      paragraph(
        "ReyLUMI may process request logs, error details, diagnostic events, browser information, device information, and performance information to operate, secure, troubleshoot, and improve the service.",
      ),
      paragraph(
        "The native app can retain authorized read models and queued workspace operations on the device for continuity and offline use. Browser storage can also hold draft or recovery information, including an unresolved post request, its caption, and uploaded file references. Local storage and a queued action are different from a confirmed server update. Local copies, hosted records, exports, and copies you download can have different access and removal lifecycles.",
      ),
      paragraph(
        "Native troubleshooting records can include bounded timing, status, command category, app or build information, and random request identifiers. The native diagnostic-report feature lets you choose to save or share a report rather than automatically uploading that report. This does not describe all server or hosting logs: normal requests and server-side security or troubleshooting records are handled separately.",
      ),
      paragraph(
        "Sponsored-content interactions and signup attribution can use campaign and session identifiers, page information, time, device or audience categories, and an account link when a signup is attributed. These uses are described under ",
        link("Information We Collect", "/privacy#information-we-collect"),
        ". Browser or device controls can affect cookies, storage, or location access, and disabling them can affect the related feature.",
      ),
    ],
  },
  {
    id: "service-providers",
    title: "Service Providers",
    blocks: [
      paragraph(
        "With your explicit permission for the post, ReyLUMI can send a processed copy of photos you choose for a Beauty or salon post to OpenAI for an automated content-safety check. Processing can include people or other personal information visible in the photo; resizing an image or removing file metadata does not make its pixels anonymous. This photo-check flow does not send private payroll, tax, bank, or support uploads, or the post caption, to OpenAI. Automated checks do not establish copyright ownership or detect every harmful or private detail. Declining this permission keeps the photo from being sent through this check; you can keep your draft and continue using unrelated features.",
      ),
      paragraph(
        "Requested features depend on providers for application hosting, database and file storage, authentication, and communications. Map and location features involve map or area-lookup providers. A checkout or other payment feature can involve the payment provider identified for that transaction. The information involved depends on the feature, such as account and request details for authentication, a file selected for storage or delivery, location or map-area information for maps, or transaction details for checkout.",
      ),
      paragraph(
        "Providers can receive information needed to handle the relevant request, including technical connection details. A provider can also have its own terms or privacy notice for a service it supplies directly to you. A provider's role depends on the service and its use of information; this policy does not treat every outside recipient as processing solely on ReyLUMI's instructions.",
      ),
      paragraph(
        "Do not send account credentials or unrelated private records to an outside provider. For questions about a provider involved in a ReyLUMI feature or a request concerning your information, use ",
        link("Contact Support", "/contact-support"),
        ".",
      ),
    ],
  },
  {
    id: "data-sharing",
    title: "Data Sharing",
    blocks: [
      subheading("At your direction"),
      paragraph(
        "Information may be shared when you choose to publish content, create a public profile, submit a review, send information to a salon, request a booking, accept a staff invitation, or otherwise use a feature that shares information with another user or workspace.",
      ),
      paragraph(
        "Choosing a recipient, exporting a file, or publishing a post changes who can receive that information. A recipient may download, print, or otherwise keep a copy. A public audience is different from a selected private recipient; neither action grants unrelated people access to payroll, tax, customer, bank, or staff records.",
      ),
      subheading("With salons, staff, and professionals"),
      paragraph(
        "Booking, customer, staff, POS, payroll, tax, and operational records can be made available to the salon, assigned staff, an authorized tax professional, or a selected document recipient through the feature used. Access depends on the salon, role, assignment, permission, and recipient relationship. Public posts and profiles have different audiences from private workspace records and drafts.",
      ),
      subheading("With service providers"),
      paragraph(
        "Information may be shared with service providers that help operate, host, secure, store, deliver, or support the platform. See ",
        link("Service Providers", "/privacy#service-providers"),
        " for more detail.",
      ),
      subheading("For safety, legal, and compliance reasons"),
      paragraph(
        "Information may be preserved or shared when required by law, legal process, government request, or when reasonably necessary to protect rights, safety, security, users, businesses, and platform integrity.",
      ),
      subheading("Ownership transfer"),
      paragraph(
        "A salon ownership transfer does not automatically expose every historical or personal record to a new Owner. Business continuity data may continue with the salon, while restricted historical records should remain limited to authorized users with appropriate need. See ",
        link("Ownership Transfer", "/business-terms#ownership-transfer"),
        ".",
      ),
      paragraph(
        "Sponsored-content measurement can involve session information and account-linked attribution as described above. Advertising-related use and disclosure remain subject to applicable law and any required notice, choice, or permission. Publishing content or accepting these Terms does not by itself authorize unrelated disclosure of private payroll, tax, customer, or staff records.",
      ),
    ],
  },
  {
    id: "data-security",
    title: "Data Security",
    blocks: [
      paragraph(
        "ReyLUMI uses reasonable technical and operational safeguards designed to protect information. These may include authentication, authorization, account session controls, business-context separation, access controls, storage controls, and operational safeguards appropriate for the platform.",
      ),
      paragraph(
        "Access to business and staff records should depend on authorization controls, not merely on what a user says their role is. Businesses should invite only authorized users, remove users who no longer need access, and review permissions after staffing or ownership changes.",
      ),
      paragraph(
        "No online system can guarantee absolute security. Users should protect credentials, use accurate recovery information, avoid sharing access, and report suspected unauthorized access promptly. These precautions do not transfer ReyLUMI's own security or privacy obligations to users or eliminate rights that applicable law protects.",
      ),
    ],
  },
  {
    id: "data-retention",
    title: "Data Retention",
    blocks: [
      paragraph(
        "No single retention period applies to every record. Retention must be tied to a specific lawful purpose, the record involved, applicable recordkeeping obligations, and any valid legal or security hold. Account use, a salon relationship, or a business preference is not by itself permission to retain all associated personal information indefinitely.",
      ),
      paragraph(
        strong("Personal profile data"),
        " supports the active account and its requested features. When account deletion is completed, the personal profile fields covered by the deletion process are removed or cleared. Limited records may remain only under the retention exceptions described here and in Account Deletion.",
      ),
      paragraph(
        strong("Public content"),
        " is visible to the audience of the publishing feature while it is published. Removal from public view and removal of retained copies are different steps. A limited copy can remain for a specific lawful moderation, safety, dispute, or legal purpose; copies already lawfully received or shared by other people cannot necessarily be recalled.",
      ),
      paragraph(
        "A photo can be used by more than one feature, such as a salon cover, a selected booking inspiration, or shared published media. Deleting one post does not necessarily remove those other uses, the underlying stored file, or cached copies at the same time. These differences do not remove applicable privacy or content-removal rights, or justify unnecessary retention. When requesting review of a photo's removal, identify the photo and any other places it appears through Contact Support so the relevant uses, rights, retention purpose, and access can be assessed.",
      ),
      paragraph(
        "When ReyLUMI creates a private copy of an ordinary photo as evidence for a support or content-rights case, access is limited to authorized operators assigned to that case. The ordinary copy is scheduled for deletion 30 days after the case is explicitly closed. A reopened case pauses that ordinary deadline. A specific legal hold must record a reason and a review date; a hold requires review and is not permission for indefinite retention. Failed cleanup is retried, so scheduled expiry is not a guarantee of immediate physical deletion. Earlier account-erasure requirements can still apply. This ordinary-photo rule does not set retention periods for POS, payroll, tax or other business records, and does not govern suspected illegal material handled through a separate safety and legal process.",
      ),
      paragraph(
        strong("Booking history and customer records"),
        " can be part of a salon's service and transaction records. Any retention after a personal account is deleted must have an applicable lawful basis and remain limited to the purpose, period, and authorized recipients for that record.",
      ),
      paragraph(
        strong("POS, payroll, tax, and audit records"),
        " can have recordkeeping or other lawful retention obligations distinct from an account profile. Not every field in those records is required by law, and a label such as payroll or tax does not justify keeping unnecessary personal details. Sensitive retained records must remain restricted to appropriate recipients.",
      ),
      paragraph(
        "Tax documents, paystubs, and other records delivered to an authorized recipient can remain in that recipient's record history. Removing or archiving a document from the sender's view does not necessarily remove the recipient's access or copies already downloaded or printed. These records remain subject to applicable retention, privacy, and access requirements. Learn more about ",
        link("Account Deletion", "/privacy#account-deletion"),
        ".",
      ),
      subheading("Hosted account and salon export access and cleanup"),
      paragraph(
        "Hosted account and salon exports created under the seven-day export controls allow new authenticated access until their stated expiry, seven days after creation. Newly issued download links last up to 15 minutes, capped by the remaining export access period, and must be kept private; anyone holding a valid download link can use it until its expiry. A permission change alone does not recall a valid bearer link already shared. Access expiry and removal of a stored file are different events. Eligible new exports enter scheduled file cleanup after expiry, with failed removals retried; physical deletion is not guaranteed at the exact access deadline. Older files and previously issued links have separate expiry and cleanup histories, and these controls do not automatically revoke or purge every historical copy. Downloaded or printed copies are not removed by hosted-file cleanup.",
      ),
    ],
  },
  {
    id: "account-deletion",
    title: "Account Deletion",
    blocks: [
      paragraph(
        "Request deletion in Settings → Personal account → Delete personal account. You can cancel during the displayed 30-day pending period. After that period, the service processes the request and retries failed steps. Save the private status link shown in Settings to check progress and whether deletion has completed after sign-out. An email notification depends on an available address and delivery service; the private status receipt remains the way to check the request without relying on email delivery.",
      ),
      paragraph(
        "A request can require verification or a lawful hold for particular records. A retention exception does not automatically prevent deletion of the account or other personal information that is no longer needed. Technical processing is not complete merely because a request has been scheduled or a pending period has ended.",
      ),
      paragraph(
        "The pending period describes the in-app account-deletion workflow, not an extension of a deadline imposed by applicable privacy law. You can raise a separate privacy request through Contact Support without waiting for that period to end. Removing the app from a device is not the same as requesting deletion of its hosted account or records.",
      ),
      list(
        item(
          "A sole salon Owner can transfer ownership or choose the in-app option to permanently close last-owner salons before scheduling deletion. Contacting support is not required to request deletion.",
        ),
        item(
          "Personal account deletion can leave particular business, payroll, tax, audit, customer, booking, or POS records only where a specific retention exception is consistent with applicable law. Business convenience alone is not a blanket exception to account deletion.",
        ),
        item(
          "The deletion workflow covers the sign-in identity, personal profile fields, authored social posts, comment and review text, personal images, and private account exports. Completion is recorded after its processing steps succeed. Minimal references can remain to preserve reply threads and structurally valid transaction records without retaining the removed public text or profile fields.",
        ),
        item(
          "Clearing an account profile or restricting a retained record does not necessarily make every related business record anonymous. Other lawful records can still identify a person and must be handled accordingly.",
        ),
      ),
      paragraph(
        "Business records after account deletion are described in the next section and in ",
        link("Business Continuity", "/business-terms#business-continuity"),
        ".",
      ),
    ],
  },
  {
    id: "business-records-after-account-deletion",
    title: "Business Records After Account Deletion",
    blocks: [
      paragraph(
        "Specific business records may remain with an authorized salon or recipient after personal account deletion when retention is permitted under applicable law and consistent with the record's purpose. Records delivered to a staff member, tax professional, or other authorized recipient can have a different lifecycle from the sender's account or document list.",
      ),
      paragraph(
        "Examples include a transaction receipt, payroll run, paystub, tax document, or audit trail that has an applicable recordkeeping requirement or other permitted retention exception. This is not a claim that every historical field must be retained or that all records are available to a successor owner.",
      ),
      paragraph(
        "Retained customer or staff contact details, legal-name or payroll snapshots, bank or check records, private support messages, and documents can still identify a person after an account link is disconnected. The same purpose, access, minimization, and applicable privacy-request requirements continue to matter for those records. A request about them is not limited to the personal-profile deletion control.",
      ),
      paragraph(
        "Access to sensitive historical records should remain limited to authorized users and should not be exposed merely because a personal account was removed or ownership changed. See ",
        link("Restricted Historical Data", "/business-terms#restricted-historical-data"),
        ".",
      ),
    ],
  },
  {
    id: "privacy-rights",
    title: "User Privacy Rights",
    blocks: [
      paragraph(
        "Depending on where you live and the law that applies, you may have rights to access, correct, delete, export, restrict, or object to certain uses of your personal information.",
      ),
      paragraph(
        "Where applicable, these rights can include knowing the categories and sources of information collected, its uses and recipients; opting out of a sale or sharing of personal information; limiting certain uses or disclosures of sensitive personal information; and exercising protected rights without unlawful discrimination. Which rights apply depends on the governing law and the particular processing, not just whether a person has an active account.",
      ),
      paragraph(
        "Requests can require proportionate identity verification and protection of other people's information. A request concerning salon-controlled records may require coordination with the responsible business. A record's presence in a salon workspace does not by itself remove applicable privacy rights. Any denial, limit, or delay must have a basis permitted by the law governing the request.",
      ),
      paragraph(
        "To ask about your information or exercise an applicable right, use ",
        link("Contact Support", "/contact-support"),
        " or email ",
        link("support@reylumi.com", "mailto:support@reylumi.com"),
        ". Explain the request without including passwords, full bank details, or unnecessary identity or tax documents. An account export supports the data included in that feature; it is not the only way to raise a privacy request.",
      ),
      subheading("Children and authorized use"),
      paragraph(
        "There is no universal minimum age in these Terms. Legal authority, appropriate consent, and any protections required for the feature and location still apply. Children's privacy requirements can apply when a service is directed to children under 13 or has actual knowledge that it is collecting their personal information, as well as in other circumstances covered by applicable law. Required notices, verifiable parental consent where required, and safeguards must precede the relevant collection. If you believe ReyLUMI is collecting a child's information in circumstances requiring additional protection, contact us through the privacy request channel above. A general permission to use a feature is not a substitute for legally required parental consent.",
      ),
    ],
  },
  {
    id: "cookies-analytics",
    title: "Cookies / Analytics",
    blocks: [
      paragraph(
        "ReyLUMI uses cookies and local browser storage for login sessions, selected workspace, authentication routing, saved preferences, and continuity of certain product workflows.",
      ),
      paragraph(
        "Sponsored-content features can also use cookies or session identifiers to measure interactions and attribute eligible signups to campaigns, including a link to a newly created account. Location-related browser state can support reuse of an area lookup. Technical and diagnostic information supports security, troubleshooting, and reliability. These descriptions do not treat identifiers as automatically anonymous or make a claim that every such activity is exempt from applicable advertising or privacy requirements.",
      ),
    ],
  },
  {
    id: "legal-requests",
    title: "Legal Requests",
    blocks: [
      paragraph(
        "ReyLUMI may preserve or disclose information when required by law, subpoena, court order, government request, or similar legal process.",
      ),
      paragraph(
        "ReyLUMI may also preserve or disclose information when reasonably necessary to protect users, businesses, ReyLUMI, the public, platform security, or the integrity of accounts and workspaces.",
      ),
    ],
  },
  {
    id: "changes",
    title: "Changes to Privacy Policy",
    blocks: [
      paragraph(
        "ReyLUMI may update this Privacy Policy as the platform, legal requirements, or business practices change. The Last updated date identifies the latest revision.",
      ),
      paragraph(
        "Material changes may require additional notice, consent, or timing where applicable law requires it.",
      ),
    ],
  },
  {
    id: "contact",
    title: "Contact",
    blocks: [
      paragraph(
        "For privacy questions or requests concerning Reylumi LLC and ReyLUMI, use ",
        link("Contact Support", "/contact-support"),
        " or the support feature in your account. Include enough information to identify the feature and request, and avoid sending unnecessary confidential records.",
      ),
    ],
  },
];

const communitySections: LegalSection[] = [
  {
    id: "purpose",
    title: "Purpose",
    blocks: [
      paragraph(
        "ReyLUMI's Community Standards help keep the platform useful, safe, and fair for clients, beauty professionals, salons, staff, owners, and business teams.",
      ),
      paragraph(
        "These standards apply to public content, reviews, beauty posts, salon profiles, customer interactions, staff interactions, booking-related conduct, and any other behavior that affects the ReyLUMI community.",
      ),
      paragraph(
        "The goal is not to remove every disagreement or negative experience. The goal is to prevent deceptive, abusive, unsafe, or unlawful behavior while allowing honest information that helps people make informed beauty and business decisions.",
      ),
    ],
  },
  {
    id: "authentic-identity",
    title: "Authentic Identity",
    blocks: [
      paragraph(
        "Use accurate identity, contact, profile, and business information. Do not impersonate another person, salon, professional, staff member, business, platform representative, or brand.",
      ),
      paragraph(
        "Authentic identity matters because bookings, reviews, staff relationships, customer history, public profiles, and business permissions depend on users knowing who they are interacting with.",
      ),
      paragraph(
        "ReyLUMI may limit accounts, content, or workspace access when identity information appears false, misleading, unauthorized, or connected to fraud or abuse.",
      ),
    ],
  },
  {
    id: "respectful-conduct",
    title: "Respectful Conduct",
    blocks: [
      paragraph(
        "Treat clients, staff, owners, professionals, and ReyLUMI team members with respect. Do not harass, threaten, shame, intimidate, sexually harass, discriminate against, or repeatedly target others.",
      ),
      paragraph(
        "Disagreements about services, refunds, cancellations, reviews, staffing, or business operations should be handled through appropriate communication and support channels. ReyLUMI may act when conduct creates safety, abuse, fraud, discrimination, privacy, or platform-integrity concerns.",
      ),
    ],
  },
  {
    id: "content",
    title: "User-Generated Content",
    blocks: [
      paragraph(
        "User-generated content includes reviews, comments, profile details, salon content, service descriptions, photos, videos, before/after posts, captions, public staff or beauty profile details, and similar material submitted to ReyLUMI.",
      ),
      list(
        item(strong("Rights."), " Only post content you have the right to share."),
        item(strong("Accuracy."), " Do not post misleading claims about services, results, prices, credentials, awards, locations, or provider identity."),
        item(strong("Safety."), " Do not post abusive, hateful, explicit, illegal, unsafe, or exploitative content."),
        item(strong("Privacy."), " Do not post private information about another person without permission."),
      ),
      paragraph(
        "Content and intellectual property obligations are also described in the ",
        link("Terms of Service", "/terms#intellectual-property"),
        ".",
      ),
    ],
  },
  {
    id: "photos-videos-before-after",
    title: "Photos, Videos and Before/After Content",
    blocks: [
      paragraph(
        "Beauty photos, videos, and before/after content should accurately represent the work shown. Do not use edited, staged, stolen, or misleading content to exaggerate results, hide material information, misrepresent a provider, or deceive clients.",
      ),
      paragraph(
        "Obtain appropriate consent before posting identifiable clients, staff, private spaces, or private communications. Be especially careful with images that show faces, tattoos, minors, medical conditions, sensitive body areas, or other identifying details.",
      ),
      paragraph(
        "If content is connected to a real appointment or verified visit, do not use that connection to imply guarantees about future results. Beauty outcomes can vary by client, service, provider, condition, and aftercare.",
      ),
    ],
  },
  {
    id: "reviews",
    title: "Reviews",
    blocks: [
      paragraph(
        "Reviews should be based on a genuine experience with the salon, provider, or service. A review can be positive, negative, or mixed, but it should help other users understand what happened without deception, abuse, or exaggeration.",
      ),
      list(
        item("Do not post fake reviews or reviews for experiences that did not happen."),
        item("Do not buy, sell, trade, or pressure someone for reviews."),
        item("Do not offer discounts, refunds, gifts, employment benefits, or other incentives in exchange for a specific review outcome."),
        item("Do not use reviews to extort discounts, refunds, free services, scheduling priority, or other benefits."),
        item("Do not coordinate review manipulation, retaliatory review campaigns, competitor attacks, or reciprocal review schemes."),
      ),
      paragraph(
        "Reviews related to appointments should be grounded in the actual service experience. Booking context is described in the ",
        link("Booking", "/terms#booking"),
        " section of the Terms.",
      ),
    ],
  },
  {
    id: "review-manipulation",
    title: "Review Manipulation",
    blocks: [
      paragraph(
        "Attempts to manipulate ratings, reviews, verified visits, public reputation, or trust signals may result in content removal, distribution changes where supported, account restrictions, or business workspace enforcement.",
      ),
      paragraph(
        "Manipulation can include fake accounts, coordinated posting, review swaps, pressure campaigns, undisclosed incentives, employee-written customer reviews, competitor sabotage, repeated removal-and-repost behavior, or threats tied to review changes.",
      ),
      note(
        "Trust signals",
        "LUMI trust signals may be based on verified visit, customer reputation, account activity, platform activity, and public-safe canonical platform data. They are not a guarantee of service quality, legal compliance, availability, safety, or future performance.",
      ),
    ],
  },
  {
    id: "harassment-threats",
    title: "Harassment and Threats",
    blocks: [
      paragraph(
        "Do not threaten, stalk, dox, bully, sexually harass, intimidate, shame, or repeatedly contact someone after they have asked you to stop.",
      ),
      paragraph(
        "Harassment can happen in reviews, messages, comments, public content, customer interactions, staff interactions, booking disputes, or business disputes. ReyLUMI may take action even when the underlying dispute is between users or between a client and provider.",
      ),
    ],
  },
  {
    id: "fraud-scams",
    title: "Fraud and Scams",
    blocks: [
      paragraph(
        "Do not use ReyLUMI for fraudulent bookings, payment scams, stolen identity, false business claims, counterfeit services, fake staff invitations, fake customer claims, deceptive promotions, or attempts to obtain money, services, access, or information through deception.",
      ),
      paragraph(
        "Fraud and scam activity may also violate the ",
        link("Prohibited Use", "/terms#prohibited-use"),
        " section of the Terms.",
      ),
    ],
  },
  {
    id: "spam",
    title: "Spam",
    blocks: [
      paragraph(
        "Do not send spam, mass unsolicited messages, repetitive promotions, misleading links, irrelevant content, deceptive booking requests, or low-quality content that disrupts the user experience.",
      ),
      paragraph(
        "Businesses should use ReyLUMI communication tools for legitimate salon operations, booking communication, customer service, and permitted marketing only where allowed by product settings and applicable law.",
      ),
    ],
  },
  {
    id: "impersonation",
    title: "Impersonation",
    blocks: [
      paragraph(
        "Do not pretend to be another user, staff member, salon, business, platform representative, rights holder, or professional. Do not create profiles, posts, reviews, invitations, or booking activity that misleads people about who is speaking or acting.",
      ),
      paragraph(
        "Using another person's images, business name, logo, credentials, contact information, or work portfolio without authority may also violate privacy or intellectual property rules.",
      ),
    ],
  },
  {
    id: "intellectual-property",
    title: "Intellectual Property",
    blocks: [
      paragraph(
        "Do not post or use photos, videos, logos, names, designs, service descriptions, captions, portfolio work, reviews, or other content that violates someone else's intellectual property rights.",
      ),
      paragraph(
        "If you believe content on ReyLUMI infringes your rights, report it through the available support or reporting channel with enough information for review.",
      ),
    ],
  },
  {
    id: "privacy-of-others",
    title: "Privacy of Others",
    blocks: [
      paragraph(
        "Do not expose private contact details, financial details, health information, payroll information, customer records, staff records, private business information, private messages, or confidential salon information without permission.",
      ),
      paragraph(
        "Before sharing photos, videos, before/after content, or customer stories, make sure you have appropriate permission from identifiable people and that the content is suitable for public display.",
      ),
      paragraph(
        "Privacy handling is described in more detail in the ",
        link("Privacy Policy", "/privacy"),
        ".",
      ),
    ],
  },
  {
    id: "enforcement",
    title: "Enforcement",
    blocks: [
      paragraph(
        "ReyLUMI may remove content, limit distribution, restrict account access, disable public content, suspend workspaces, limit features, or take other action when needed to enforce these standards, protect users, or comply with law.",
      ),
      paragraph(
        "Enforcement can consider context, severity, repeat behavior, evidence, risk to users, business impact, safety needs, legal obligations, and whether the behavior appears accidental, negligent, deceptive, or intentional.",
      ),
    ],
  },
  {
    id: "appeals",
    title: "Appeals",
    blocks: [
      paragraph(
        "Where an appeal channel is available, users may request review of an enforcement decision. An appeal should explain why the decision may be mistaken and include relevant context or evidence.",
      ),
      paragraph(
        "Appeals do not guarantee reinstatement. ReyLUMI may uphold, modify, or reverse an enforcement action based on the information available and applicable law.",
      ),
    ],
  },
  {
    id: "reporting-content",
    title: "Reporting Content",
    blocks: [
      paragraph(
        "Report content or behavior through available product, support, or moderation channels. Include relevant context, links, screenshots where appropriate, booking details, or business information so the issue can be reviewed.",
      ),
      paragraph(
        "False, abusive, or retaliatory reports may themselves violate these standards.",
      ),
    ],
  },
];

const businessSections: LegalSection[] = [
  {
    id: "business-accounts",
    title: "Business Accounts",
    blocks: [
      paragraph(
        "Business accounts and salon workspaces are used by salons, Owners, staff, beauty professionals, and other authorized users to manage operations through ReyLUMI.",
      ),
      paragraph(
        strong("A business workspace"),
        " may include salon profile information, services, prices, locations, booking settings, staff relationships, customer records, POS records, payroll records, tax-related operational records, reports, public content, and permissions.",
      ),
      paragraph(
        "The business is responsible for making sure the people using the workspace are authorized and that the information entered into ReyLUMI is accurate, lawful, and appropriate for the business purpose.",
      ),
      paragraph(
        "A business must have authority and any required permission to submit customer, staff, payroll, tax, identity, or other confidential information and to choose its recipients. Workspace authority is not a substitute for the rights of the people concerned. These responsibilities do not remove Reylumi LLC's independent obligations for its own processing, security practices, or representations.",
      ),
    ],
  },
  {
    id: "salon-responsibilities",
    title: "Salon Responsibilities",
    blocks: [
      paragraph(
        "The salon or business is responsible for the accuracy of its business profile, services, pricing, availability, staff information, customer communications, policies, licensing, professional obligations, tax obligations, payroll obligations, and legal compliance.",
      ),
      paragraph(
        "ReyLUMI may provide tools for managing these records, but the salon remains responsible for reviewing them, correcting errors, and deciding how to use them in real-world business operations.",
      ),
      paragraph(
        "Public-facing salon information should be truthful, current, and not misleading. This includes service descriptions, prices, duration, staff availability, profile content, photos, branding, and booking rules.",
      ),
    ],
  },
  {
    id: "owner-responsibilities",
    title: "Owner Responsibilities",
    blocks: [
      paragraph(
        "Owners are responsible for maintaining authorized access, inviting or removing users appropriately, reviewing permissions, preserving business records, and ensuring that business data is used lawfully.",
      ),
      paragraph(
        "An Owner should have legal or operational authority to manage the salon workspace. Owner access should not be used to take over a salon, staff relationship, customer history, or business record without authorization.",
      ),
      paragraph(
        "Owners should pay particular attention to sensitive records such as payroll, tax, customer, staff financial, audit, and historical ownership records.",
      ),
    ],
  },
  {
    id: "multiple-owners",
    title: "Multiple Owners",
    blocks: [
      paragraph(
        "A salon may have multiple Owners. Owner access must come from account authorization, salon authorization, invitation, membership, or another server-side permission source.",
      ),
      paragraph(
        strong("Owner authority"),
        " is determined by server-side authorization, not by client-side role labels alone. A label displayed in the interface is not enough by itself to prove that a user may access sensitive records, transfer ownership, manage payroll, or make business decisions.",
      ),
      paragraph(
        "Multiple Owners should coordinate access changes, business record responsibilities, staff permissions, and ownership transitions carefully so the salon can continue operating without exposing restricted information unnecessarily.",
      ),
    ],
  },
  {
    id: "staff-relationships",
    title: "Staff Relationships",
    blocks: [
      paragraph(
        "Staff @ Salon is a relationship within a salon workspace. ReyLUMI does not become the employer, accountant, payroll provider, tax advisor, or law firm for the business merely because staff, payroll, booking, POS, or tax-related records are stored or calculated in the platform.",
      ),
      paragraph(
        "The salon is responsible for classification, employment status, contractor status, compensation agreements, commission arrangements, tip treatment, labor obligations, licensing, supervision, workplace compliance, and required notices.",
      ),
      paragraph(
        "A staff member may have a personal ReyLUMI account or public profile, but business access depends on the salon relationship and permissions granted for that workspace. Staff records should be accessed only for legitimate salon operations.",
      ),
    ],
  },
  {
    id: "permissions-access",
    title: "Permissions and Access",
    blocks: [
      paragraph(
        "Business features may be controlled by permissions such as booking, services, staff, POS, reports, payroll, tax-company, salon profile, customer records, or salon settings access.",
      ),
      paragraph(
        "Businesses should regularly review access, invite only authorized users, remove users who no longer need access, and adjust permissions after staffing changes, ownership changes, role changes, or security concerns.",
      ),
      paragraph(
        "Sensitive features, such as payroll, tax-company views, financial corrections, and restricted historical records, should be limited to users with appropriate authorization and business need.",
      ),
    ],
  },
  {
    id: "services-availability",
    title: "Services and Availability",
    blocks: [
      paragraph(
        "The business is responsible for service definitions, descriptions, prices, durations, service categories, staff eligibility, public booking settings, working hours, breaks, time blocks, and availability rules.",
      ),
      paragraph(
        "If a service changes, the business should update ReyLUMI before relying on public booking pages, staff schedules, POS tickets, payroll calculations, or reports that depend on that service configuration.",
      ),
      paragraph(
        "Availability tools help organize schedules, but they do not replace the salon's responsibility to confirm that staff, space, supplies, licensing, and service readiness are in place.",
      ),
    ],
  },
  {
    id: "booking-responsibility",
    title: "Booking Responsibility",
    blocks: [
      paragraph(
        "The business is responsible for reviewing requested bookings, honoring accepted bookings, communicating changes, assigning staff appropriately, and applying cancellation or no-show policies only when those policies are displayed and legally enforceable.",
      ),
      paragraph(
        "A booking request, calendar display, or availability setting does not by itself guarantee that a service can be performed. The salon or provider controls the real-world service experience.",
      ),
      paragraph(
        "Client-facing booking terms are described in the ",
        link("Booking", "/terms#booking"),
        " section of the Terms.",
      ),
    ],
  },
  {
    id: "pos-records",
    title: "POS Records",
    blocks: [
      paragraph(
        "ReyLUMI is an operational tool for POS records. ",
        strong("Current POS entries can be record-only"),
        "; unless a checkout or payment-processing integration states otherwise, recording a payment method or amount in ReyLUMI does not by itself move funds or resolve payment disputes.",
      ),
      paragraph(
        "POS records may include tickets, service or item lines, staff attribution, discounts, tips, tax rates or tax amounts, payment records or notes, receipts, daily closings, corrections, and audit history. ReyLUMI records and calculates based on configured and entered data.",
      ),
      paragraph(
        "The business is responsible for verifying transactions, prices, tips, discounts, taxes, payment entries, corrections, receipts, and reports before relying on them for customer service, payroll, accounting, tax, or legal purposes.",
      ),
      paragraph(
        "POS data may affect ",
        link("Payroll", "/business-terms#payroll"),
        " and ",
        link("Tax", "/business-terms#tax"),
        " outputs, so corrections should be handled carefully.",
      ),
    ],
  },
  {
    id: "payments",
    title: "Payments",
    blocks: [
      paragraph(
        "Where payment collection or payment records are supported, the business remains responsible for accurate collection, reconciliation, refunds, disputes, chargebacks, taxes, merchant obligations, and provider obligations.",
      ),
      paragraph(
        "A feature that uses an actual payment-processing integration can require additional processor terms, settlement checks, dispute handling, and merchant obligations. The terms and provider identified for the transaction apply. A ReyLUMI POS record alone does not prove that money was collected or settled.",
      ),
      paragraph(
        "Refund and cancellation treatment should align with the salon policy shown to the client, any processor rules that apply, and applicable law. ReyLUMI does not create a universal salon refund policy.",
      ),
    ],
  },
  {
    id: "payroll",
    title: "Payroll",
    blocks: [
      note(
        "Payroll disclaimer",
        "Using ReyLUMI for calculations or records does not by itself make ReyLUMI the employer, accountant, payroll disbursement provider, tax advisor, or law firm for the business. Any separately agreed service remains subject to its actual scope and applicable law.",
      ),
      paragraph(
        strong("Payroll outputs"),
        " may depend on compensation configuration, commission settings, pay type, tips, bonuses, deductions, tax-company settings, staff assignments, work records, service attribution, ticket corrections, and other user-entered or salon-configured information.",
      ),
      list(
        item("The business must verify compensation, commissions, tips, bonuses, deductions, and paystub outputs before paying staff or recording payroll decisions."),
        item("The business must verify staff classification, tax treatment, reporting, withholding, payroll schedules, required notices, and compliance obligations."),
        item("Payroll records may require retention even after account changes, staff departures, salon ownership changes, or workspace access changes."),
      ),
      paragraph(
        "Payroll may depend on ",
        link("POS Records", "/business-terms#pos-records"),
        ", staff relationships, services, and ",
        link("Tax", "/business-terms#tax"),
        " settings. Businesses should consult qualified advisors for employment, payroll, accounting, and tax questions.",
      ),
      paragraph(
        "A payroll report or payment entry does not by itself establish that wages were paid, required deposits were made, or returns were filed. The business must verify those events through the actual payment or filing process. Its duty to review outputs does not excuse a defect in ReyLUMI's own calculations, processing, or access controls.",
      ),
    ],
  },
  {
    id: "tax",
    title: "Tax",
    blocks: [
      paragraph(
        strong("Tax settings and reports"),
        ", including tax-company views, reported wages, taxable gross, tax withheld, taxable sales, tax rates, and similar outputs, are tools for operational record keeping. They are not tax advice.",
      ),
      paragraph(
        "Tax laws and reporting obligations vary by jurisdiction, business type, worker classification, service type, product type, and transaction details. The business is responsible for final filing, payment, reporting, registration, exemption handling, and compliance decisions.",
      ),
      paragraph(
        "Businesses should review all tax-related outputs with qualified advisors before filing returns, paying taxes, issuing tax forms, or making legal compliance decisions.",
      ),
      paragraph(
        "Tax profiles, messages, paystubs, and uploaded forms or images can contain legal names, contact information, Social Security numbers, EINs, wage and withholding details, and other private financial information. Submit only information you are authorized to provide, select recipients carefully, and use it only for the authorized purpose. A technical connection to a tax professional does not establish professional credentials or an authorization to file or pay tax on another person's behalf.",
      ),
      paragraph(
        "Removing or archiving a sent document can remove it from the sender's view without withdrawing an authorized recipient's record or a copy already downloaded or printed. Retention and access remain subject to the document's purpose, applicable law, and the relevant permissions; do not assume all historical documents become available to a newly connected owner or professional.",
      ),
    ],
  },
  {
    id: "customer-business-data",
    title: "Customer and Business Data",
    blocks: [
      paragraph(
        "Customer and business data should be accessed only by authorized users and only for legitimate salon operations, service delivery, recordkeeping, customer service, legal compliance, support, and business continuity.",
      ),
      paragraph(
        "Customer records may include contact information, appointment history, service history, receipts, account-claim information, reviews, and salon-specific customer history. Business users should avoid accessing or exporting customer data without a legitimate purpose.",
      ),
      paragraph(
        "Salons determine the inputs, recipients, and business decisions for their requested workspace activities. ReyLUMI processes the records to provide those tools and also has responsibilities for its own platform purposes and conduct. The applicable data role depends on each use and the governing law; these Terms do not declare ReyLUMI a service provider or processor for every activity or replace any additional data-processing terms required by law.",
      ),
      paragraph(
        "Privacy handling for customer and booking data is described in the ",
        link("Privacy Policy", "/privacy#customer-booking-data"),
        ".",
      ),
    ],
  },
  {
    id: "business-continuity",
    title: "Business Continuity",
    blocks: [
      paragraph(
        "Certain records help a salon continue operating, including salon profile, business name, branding, services, staff relationships, booking configuration, public reviews, public salon content, and operational settings.",
      ),
      paragraph(
        "Business continuity matters when staff changes, owners change, accounts are deleted, or a salon needs to preserve customer service and recordkeeping. Continuity does not mean every historical or sensitive record should be visible to every current user.",
      ),
      paragraph(
        "Retention and account deletion are described in the ",
        link("Data Retention", "/privacy#data-retention"),
        " and ",
        link("Account Deletion", "/privacy#account-deletion"),
        " sections of the Privacy Policy.",
      ),
    ],
  },
  {
    id: "ownership-transfer",
    title: "Ownership Transfer",
    blocks: [
      paragraph(
        strong("Ownership transfer"),
        " is about changing who has authority to manage a salon workspace. It should not become a destructive rewrite of data ownership. A salon may need continuity while preserving sensitive historical access boundaries.",
      ),
      subheading("Business continuity data"),
      paragraph(
        "Business continuity data may continue with the salon where appropriate. This can include salon profile, business name, branding, services, staff relationships, booking configuration, public reviews, public salon content, public booking settings, and operational configuration needed to keep the salon functioning.",
      ),
      subheading("Restricted or historical data"),
      paragraph(
        "Sensitive or historical data does not automatically transfer, including payroll history, employee financial data, tax information, private previous-owner data, restricted audit records, and customer information beyond what is permitted or necessary.",
      ),
      paragraph(
        "A new Owner should receive only the access appropriate for their authority, the salon's continuity needs, and applicable law. A previous Owner's private information should not become visible merely because ownership changed.",
      ),
      subheading("Future sharing controls"),
      paragraph(
        "Future product support may allow an outgoing Owner to choose what historical data is shared when the system supports it, the sender has authority, and applicable law permits it.",
      ),
      paragraph(
        "Ownership transfer should be handled with care because it can affect ",
        link("Restricted Historical Data", "/business-terms#restricted-historical-data"),
        ", ",
        link("Payroll", "/business-terms#payroll"),
        ", ",
        link("Tax", "/business-terms#tax"),
        ", and customer records.",
      ),
    ],
  },
  {
    id: "restricted-historical-data",
    title: "Restricted Historical Data",
    blocks: [
      paragraph(
        "Historical payroll, tax, staff financial, private owner, customer, audit, and sensitive business records should remain restricted to users with appropriate authorization and legal need.",
      ),
      paragraph(
        "Restricted data should not be exposed simply because a user is a current staff member, a new Owner, or someone with general salon access. Access should be based on the specific permission, purpose, and business need.",
      ),
      paragraph(
        "Businesses should consider legal retention requirements, employee privacy, customer privacy, tax obligations, audit requirements, and dispute needs before sharing or deleting historical records.",
      ),
    ],
  },
  {
    id: "security-access-control",
    title: "Security and Access Control",
    blocks: [
      paragraph(
        "Businesses should use strong account security, invite only authorized users, maintain current staff records, review permissions after staffing or ownership changes, and promptly remove access that is no longer needed.",
      ),
      paragraph(
        "If a business suspects unauthorized access, misuse of a staff account, incorrect Owner access, or improper exposure of restricted records, it should act promptly to update permissions and contact support where needed.",
      ),
    ],
  },
  {
    id: "suspension-business-disputes",
    title: "Suspension / Business Disputes",
    blocks: [
      paragraph(
        "ReyLUMI may limit or suspend business access when needed to protect users, address security issues, comply with law, investigate misuse, manage unresolved ownership or authorization disputes, or protect platform integrity.",
      ),
      paragraph(
        "ReyLUMI does not resolve employment, ownership, customer, service, tax, payroll, or accounting disputes except as needed to operate and protect the platform. Businesses should seek qualified professional advice for legal, employment, accounting, payroll, or tax disputes.",
      ),
    ],
  },
  {
    id: "contact",
    title: "Contact",
    blocks: [
      paragraph(
        "For questions about these Business & Salon Terms, use ",
        link("Contact Support", "/contact-support"),
        " or the support feature in your account. Identify the business and feature involved without including credentials or unnecessary customer, staff, payroll, or tax records.",
      ),
    ],
  },
];

export const legalDocuments = {
  terms: {
    description:
      "Terms that explain how clients, professionals, staff, and businesses use ReyLUMI.",
    href: "/terms",
    lastUpdated: LEGAL_LAST_UPDATED,
    intro:
      "Rules for accounts, bookings, payments, content, disputes, platform outputs, and responsible use of ReyLUMI.",
    sections: termsSections,
    shortTitle: "Terms",
    title: "Terms of Service",
  },
  privacy: {
    description:
      "How ReyLUMI collects, uses, shares, secures, and retains personal and business information.",
    href: "/privacy",
    intro:
      "How personal accounts, bookings, public content, business data, staff records, POS records, payroll records, and deletion requests are handled.",
    sections: privacySections,
    shortTitle: "Privacy",
    title: "Privacy Policy",
  },
  community: {
    description:
      "Standards for reviews, public content, trust signals, respectful conduct, and reporting.",
    href: "/community",
    intro:
      "Community expectations for authentic, respectful, useful, and safe participation on ReyLUMI.",
    sections: communitySections,
    shortTitle: "Community",
    title: "Community Standards",
  },
  business: {
    description:
      "Terms for salons, owners, staff, professionals, POS records, payroll, tax, and ownership continuity.",
    href: "/business-terms",
    intro:
      "Business-specific terms for salon workspaces, operational records, permissions, payroll, tax, and ownership transfer.",
    sections: businessSections,
    shortTitle: "Business",
    title: "Business & Salon Terms",
  },
} as const satisfies Record<string, LegalDocument>;

export const legalPolicyGroups: LegalPolicyGroup[] = [
  {
    id: "core",
    title: "Core",
    policies: [
      {
        description: legalDocuments.terms.intro,
        href: legalDocuments.terms.href,
        label: legalDocuments.terms.title,
      },
      {
        description: legalDocuments.privacy.intro,
        href: legalDocuments.privacy.href,
        label: legalDocuments.privacy.title,
      },
    ],
  },
  {
    id: "community",
    title: "Community",
    policies: [
      {
        description: legalDocuments.community.intro,
        href: legalDocuments.community.href,
        label: legalDocuments.community.title,
      },
    ],
  },
  {
    id: "business",
    title: "For Businesses",
    policies: [
      {
        description: legalDocuments.business.intro,
        href: legalDocuments.business.href,
        label: legalDocuments.business.title,
      },
    ],
  },
];

export const additionalPolicyLinks = [
  { href: "/terms#booking", label: "Booking & Cancellation" },
  { href: "/terms#payments", label: "Payments & Refunds" },
  { href: "/community#reviews", label: "Reviews & Trust" },
  { href: "/community#content", label: "Content & Intellectual Property" },
  { href: "/privacy#data-retention", label: "Data Retention" },
  { href: "/privacy#account-deletion", label: "Account Deletion" },
  {
    href: "/business-terms#ownership-transfer",
    label: "Salon Ownership Transfer",
  },
] as const;

export function legalMetadata(input: {
  description: string;
  path: string;
  title: string;
}): Metadata {
  return {
    alternates: {
      canonical: input.path,
    },
    description: input.description,
    title: `${input.title} | ${REYLUMI_APP_NAME}`,
  };
}
