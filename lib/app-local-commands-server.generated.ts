// Generated from the reviewed, explicit app-local-command-policy.json.
import "server-only";
import {ownerSubmitAttendance as action0} from "@/app/pos/owner-check-in-actions";
import {cancelWaitingVisitForPos as action1} from "@/app/pos/actions";
import {createPosDeskCustomer as action2} from "@/app/pos/actions";
import {getPosLiveDraft as action3} from "@/app/pos/actions";
import {resolveScannedCheckinReceipt as action4} from "@/app/pos/actions";
import {searchPosDeskCustomers as action5} from "@/app/pos/actions";
import {selectWaitingVisitForPos as action6} from "@/app/pos/actions";
import {submitPosDeskReceipt as action7} from "@/app/pos/actions";
import {touchCustomerDisplayLiveDraftActivity as action8} from "@/app/pos/actions";
import {updatePosActiveDraft as action9} from "@/app/pos/actions";
import {updatePosLiveDraftCustomer as action10} from "@/app/pos/actions";
import {confirmCustomerDisplayLiveDraftTip as action11} from "@/app/pos/actions";
import {findLiveDraftCustomerByPhone as action12} from "@/app/pos/actions";
import {createLiveDraftCustomer as action13} from "@/app/pos/actions";
import {getCustomerDisplayLiveDraftTipOptions as action14} from "@/app/pos/actions";
import {resetCustomerDisplayCompletedDraft as action15} from "@/app/pos/actions";
import {saveCustomerDisplayRequestedServices as action16} from "@/app/pos/actions";
import {searchCustomerDisplayLiveDraftCustomers as action17} from "@/app/pos/actions";
import {submitCustomerDisplayPhone as action18} from "@/app/pos/actions";
import {findServiceRelay as action19} from "@/app/service-relay/actions";
import {loadServiceRelay as action20} from "@/app/service-relay/actions";
import {respondServiceRelay as action21} from "@/app/service-relay/actions";
import {saveServiceRelay as action22} from "@/app/service-relay/actions";
import {setServiceRelayPlugin as action23} from "@/app/service-relay/actions";
import {submitServiceRelay as action24} from "@/app/service-relay/actions";
import {issueServiceRelayPass as action25} from "@/app/service-relay/actions";
import {createBookingPosTicketAction as action26} from "@/app/bookings/actions";
import {createQuickSetupStaffAction as action27} from "@/app/bookings/actions";
import {createOwnerAppointmentAction as action28} from "@/app/bookings/actions";
import {reassignOwnerBookingAction as action29} from "@/app/bookings/actions";
import {rescheduleOwnerBookingAction as action30} from "@/app/bookings/actions";
import {runBookingStatusAction as action31} from "@/app/bookings/actions";
import {saveOwnerWorkspaceBookingAction as action32} from "@/app/bookings/actions";
import {replaceOwnerBookingServicesAction as action33} from "@/app/bookings/actions";
import {updateBookingSettingsAction as action34} from "@/app/bookings/actions";
import {updateQuickSetupAssignmentAction as action35} from "@/app/bookings/actions";
import {updateQuickSetupServiceOnlineAction as action36} from "@/app/bookings/actions";
import {updateQuickSetupStaffOnlineAction as action37} from "@/app/bookings/actions";
import {cancelStaffTimeBlockAction as action38} from "@/app/booking-setup/actions";
import {createStaffTimeBlockAction as action39} from "@/app/booking-setup/actions";
import {saveStaffWeeklyAvailabilityAction as action40} from "@/app/booking-setup/actions";
import {createServiceAction as action41} from "@/app/services/actions";
import {saveServiceConfigsAction as action42} from "@/app/services/actions";
import {addPosPayment as action43} from "@/app/pos-tickets/actions";
import {addPosTicketItem as action44} from "@/app/pos-tickets/actions";
import {cancelPosTicket as action45} from "@/app/pos-tickets/actions";
import {closePosTicket as action46} from "@/app/pos-tickets/actions";
import {correctClosedPosTicketInline as action47} from "@/app/pos-tickets/actions";
import {deletePosPayment as action48} from "@/app/pos-tickets/actions";
import {deletePosTicketItem as action49} from "@/app/pos-tickets/actions";
import {reopenPosTicket as action50} from "@/app/pos-tickets/actions";
import {submitLockedStaffFinancialCorrection as action51} from "@/app/pos-tickets/actions";
import {updatePosTicketDiscount as action52} from "@/app/pos-tickets/actions";
import {updatePosTicketItemStaff as action53} from "@/app/pos-tickets/actions";
import {updatePosTicketTaxRate as action54} from "@/app/pos-tickets/actions";
import {updatePosTicketTip as action55} from "@/app/pos-tickets/actions";
import {voidPosTicket as action56} from "@/app/pos-tickets/actions";
import {saveDailyPosClosing as action57} from "@/app/reports/actions";
import {submitDailyClosingCorrection as action58} from "@/app/reports/actions";
import {applyDailyClosingCorrection as action59} from "@/app/reports/actions";
import {loadHistoryDetailsAction as action60} from "@/app/activity/history-details-actions";
import {loadHistoryEvidenceAction as action61} from "@/app/activity/history-link-actions";
import {setHistoryLinkAction as action62} from "@/app/activity/history-link-actions";
import {recordVisitExperienceAction as action63} from "@/app/activity/actions";
import {cancelCustomerBookingAction as action64} from "@/app/my-bookings/actions";
import {loadCustomerRescheduleSlotsAction as action65} from "@/app/my-bookings/actions";
import {rescheduleCustomerBookingAction as action66} from "@/app/my-bookings/actions";
import {removeAppLocalFollowingAction as action67} from "@/app/local-app/customer-social-actions";
import {removeAppLocalSavedPostAction as action68} from "@/app/local-app/customer-social-actions";
import {setExploreSalonPreferenceAction as action69} from "@/app/explore/social-actions";
import {referenceLoveAction as action70} from "@/app/explore/account-actions";
import {referenceLoveStatesAction as action71} from "@/app/explore/account-actions";
import {salonLoveAction as action72} from "@/app/explore/account-actions";
import {getAccountSavedPostStatesAction as action73} from "@/app/saved-post/actions";
import {setAccountSavedPostAction as action74} from "@/app/saved-post/actions";
import {acceptStaffInviteByRequestFormAction as action75} from "@/app/staff/actions";
import {becomeOwnerStaffAction as action76} from "@/app/staff/actions";
import {cancelStaffSalonApplicationFormAction as action77} from "@/app/staff/actions";
import {createSalonStaffInviteFormAction as action78} from "@/app/staff/actions";
import {createStaff as action79} from "@/app/staff/actions";
import {declineStaffInviteByRequestFormAction as action80} from "@/app/staff/actions";
import {getStaffProfileAvatarUploadSessionAction as action81} from "@/app/staff/actions";
import {resendSalonStaffInviteFormAction as action82} from "@/app/staff/actions";
import {resetStaffPasscodeFormAction as action83} from "@/app/staff/actions";
import {reviewStaffSalonApplicationFormAction as action84} from "@/app/staff/actions";
import {revokeSalonStaffInviteFormAction as action85} from "@/app/staff/actions";
import {updateOwnStaffPasscodeAction as action86} from "@/app/staff/actions";
import {updateStaffDirectoryBatchFormAction as action87} from "@/app/staff/actions";
import {updateStaffPublicProfileAction as action88} from "@/app/staff/actions";
import {saveStaffDirectoryEntryAction as action89} from "@/app/staff/actions";
import {checkInStaffWorkday as action90} from "@/app/staff/workday/actions";
import {checkOutStaffWorkday as action91} from "@/app/staff/workday/actions";
import {updateStaffWorkdayStatus as action92} from "@/app/staff/workday/actions";
import {saveTodayQuickAccessesAction as action93} from "@/app/staff/today/actions";
import {saveBookSms as action94} from "@/app/market/booksms-actions";
import {taxCompanyPaymentAction as action95} from "@/app/market/tax-company-actions";
import {bookingDepositBillingAction as action96} from "@/app/market/booking-deposit-actions";
import {connectBookingStripeAction as action97} from "@/app/market/booking-deposit-actions";
import {installBookingDepositAction as action98} from "@/app/market/booking-deposit-actions";
import {loadBookingDepositAction as action99} from "@/app/market/booking-deposit-actions";
import {saveBookingDepositAction as action100} from "@/app/market/booking-deposit-actions";
import {bookingPolicyPaymentAction as action101} from "@/app/market/booking-policy-actions";
import {saveBookingPolicy as action102} from "@/app/market/booking-policy-actions";
import {checkinReceiptPaymentAction as action103} from "@/app/market/checkin-receipt-actions";
import {buyCampaignCreditsAction as action104} from "@/app/campaigns/credit-actions";
import {saveCampaignTopupAction as action105} from "@/app/campaigns/credit-actions";
import {setCampaignPluginAction as action106} from "@/app/campaigns/credit-actions";
import {campaignWalletAction as action107} from "@/app/campaigns/credit-actions";
import {campaignPaymentControlAction as action108} from "@/app/campaigns/credit-actions";
import {campaignCardSetupAction as action109} from "@/app/campaigns/credit-actions";
import {loadCampaignCardAction as action110} from "@/app/campaigns/credit-actions";
import {loadCampaignLedgerAction as action111} from "@/app/campaigns/credit-actions";
import {saveCampaignRemindersAction as action112} from "@/app/campaigns/credit-actions";
import {setPayrollDataPlugin as action113} from "@/app/market/plugin-actions";
import {refreshCardPurchase as action114} from "@/app/market/card-payment-actions";
import {startCardCheckout as action115} from "@/app/market/card-payment-actions";
import {setVietnamesePlugin as action116} from "@/app/market/vietnamese-actions";
import {vietnamesePaymentAction as action117} from "@/app/market/vietnamese-actions";
import {beginBookingDepositCheckoutAction as action118} from "@/app/market/booking-deposit-purchase-actions";
import {cancelAccountDeletionAction as action119} from "@/app/account/actions";
import {createOwnerTransferInviteAction as action120} from "@/app/account/actions";
import {generateAccountDeletionBackupAction as action121} from "@/app/account/actions";
import {getAccountAvatarUploadSessionAction as action122} from "@/app/account/actions";
import {requestAccountDeletionAction as action123} from "@/app/account/actions";
import {sendAccountPhoneVerificationOtpAction as action124} from "@/app/account/actions";
import {updateAccountProfileAction as action125} from "@/app/account/actions";
import {verifyAccountPhoneOtpAction as action126} from "@/app/account/actions";
import {createBeautyPostAction as action127} from "@/app/beauty/actions";
import {deleteBeautyAvatarMediaAction as action128} from "@/app/beauty/actions";
import {deleteBeautyMediaAction as action129} from "@/app/beauty/actions";
import {deleteBeautyPostAction as action130} from "@/app/beauty/actions";
import {getBeautyAvatarUploadSessionAction as action131} from "@/app/beauty/actions";
import {getBeautyMediaUploadSessionAction as action132} from "@/app/beauty/actions";
import {loadBeautyTimelineAction as action133} from "@/app/beauty/actions";
import {searchBeautyAttributionSalonsAction as action134} from "@/app/beauty/actions";
import {updateBeautyPostCaptionAction as action135} from "@/app/beauty/actions";
import {updateBeautyProfileAction as action136} from "@/app/beauty/actions";
import {loadPersonalPublicProfileSettings as action137} from "@/app/settings/personal-public-profile-actions";
import {beginPhoneMfaEnrollmentAction as action138} from "@/app/settings/login-security/actions";
import {beginTotpEnrollmentAction as action139} from "@/app/settings/login-security/actions";
import {changeAccountPasswordAction as action140} from "@/app/settings/login-security/actions";
import {createRecoveryRequestAction as action141} from "@/app/settings/login-security/actions";
import {disableMfaFactorAction as action142} from "@/app/settings/login-security/actions";
import {generateRecoveryCodesAction as action143} from "@/app/settings/login-security/actions";
import {logOutAllSessionsAction as action144} from "@/app/settings/login-security/actions";
import {logOutCurrentSessionAction as action145} from "@/app/settings/login-security/actions";
import {removeTrustedDeviceAction as action146} from "@/app/settings/login-security/actions";
import {revokeLoginSessionAction as action147} from "@/app/settings/login-security/actions";
import {secureMyAccountAction as action148} from "@/app/settings/login-security/actions";
import {trustCurrentDeviceAction as action149} from "@/app/settings/login-security/actions";
import {updateLoginSecurityPreferencesAction as action150} from "@/app/settings/login-security/actions";
import {verifyPhoneMfaEnrollmentAction as action151} from "@/app/settings/login-security/actions";
import {verifyTotpEnrollmentAction as action152} from "@/app/settings/login-security/actions";
import {loadPersonalSettingsSection as action153} from "@/app/settings/load-personal-section";
import {loadSettingsConnections as action154} from "@/app/settings/connections-actions";
import {searchSettingsConnectionSalons as action155} from "@/app/settings/connections-actions";
import {updateSettingsConnection as action156} from "@/app/settings/connections-actions";
import {createSettingsSalon as action157} from "@/app/settings/salon-list-actions";
import {loadSettingsSalonList as action158} from "@/app/settings/salon-list-actions";
import {saveSettingsSalon as action159} from "@/app/settings/salon-list-actions";
import {selectSettingsSalon as action160} from "@/app/settings/salon-list-actions";
import {loadDirectSettings as action161} from "@/app/settings/direct-settings-actions";
import {runDirectLifecycle as action162} from "@/app/settings/direct-settings-actions";
import {runDirectOwnership as action163} from "@/app/settings/direct-settings-actions";
import {runDirectStaffRequest as action164} from "@/app/settings/direct-settings-actions";
import {saveDirectBooking as action165} from "@/app/settings/direct-settings-actions";
import {saveDirectHours as action166} from "@/app/settings/direct-settings-actions";
import {saveDirectPayroll as action167} from "@/app/settings/direct-settings-actions";
import {saveDirectSalonProfile as action168} from "@/app/settings/direct-settings-actions";
import {saveDirectSpecialHours as action169} from "@/app/settings/direct-settings-actions";
import {saveDirectStaff as action170} from "@/app/settings/direct-settings-actions";
import {beginSalonVerificationAction as action171} from "@/app/settings/salon-verification-actions";
import {confirmSalonVerificationAction as action172} from "@/app/settings/salon-verification-actions";
import {loadSalonVerificationAction as action173} from "@/app/settings/salon-verification-actions";
import {loadSalonProfilePreferencesAction as action174} from "@/app/settings/salon-profile-preferences-actions";
import {saveSalonProfilePreferencesAction as action175} from "@/app/settings/salon-profile-preferences-actions";
import {createSalonProfileLookAction as action176} from "@/app/salon-profile/actions";
import {createSalonProfileReviewReplyAction as action177} from "@/app/salon-profile/actions";
import {createSalonProfileSocialPostAction as action178} from "@/app/salon-profile/actions";
import {createSalonProfileUpdateAction as action179} from "@/app/salon-profile/actions";
import {deleteSalonProfileLookAction as action180} from "@/app/salon-profile/actions";
import {deleteSalonProfileLookDirectAction as action181} from "@/app/salon-profile/actions";
import {deleteSalonProfileMediaAction as action182} from "@/app/salon-profile/actions";
import {getSalonProfileMediaUploadSessionAction as action183} from "@/app/salon-profile/actions";
import {pinSalonProfileLookAction as action184} from "@/app/salon-profile/actions";
import {setSalonProfileLookStatusAction as action185} from "@/app/salon-profile/actions";
import {setSalonProfileLookStatusDirectAction as action186} from "@/app/salon-profile/actions";
import {setSalonProfilePublicationAction as action187} from "@/app/salon-profile/actions";
import {toggleSalonFollowAction as action188} from "@/app/salon-profile/actions";
import {toggleSalonLookSaveAction as action189} from "@/app/salon-profile/actions";
import {updateSalonProfileIdentityAction as action190} from "@/app/salon-profile/actions";
import {updateSalonProfileIdentityMediaAction as action191} from "@/app/salon-profile/actions";
import {loadHiddenPostIdentitiesAction as action192} from "@/app/post-moderation/actions";
import {postModerationAction as action193} from "@/app/post-moderation/actions";
import {reportSalonAction as action194} from "@/app/salon-profile/report-actions";
import {loadBlockedUsers as action195} from "@/app/post-moderation/block-actions";
import {setUserBlocked as action196} from "@/app/post-moderation/block-actions";
import {loadProfileOperatingHours as action197} from "@/app/salon-profile/operating-hours-actions";
import {loadVisibleProfileHours as action198} from "@/app/salon-profile/operating-hours-actions";
import {saveProfileOperatingHours as action199} from "@/app/salon-profile/operating-hours-actions";
import {createPostCommentAction as action200} from "@/app/post-comments/actions";
import {deletePostCommentAction as action201} from "@/app/post-comments/actions";
import {hidePostCommentAction as action202} from "@/app/post-comments/actions";
import {updatePostCommentAction as action203} from "@/app/post-comments/actions";
import {downloadSettingsSalonBackup as action204} from "@/app/settings/settings-extra-actions";
import {refreshSettingsMap as action205} from "@/app/settings/settings-extra-actions";
import {resolveSettingsClosureRecord as action206} from "@/app/settings/settings-extra-actions";
import {saveSettingsProfileIdentity as action207} from "@/app/settings/settings-extra-actions";
import {saveSettingsPublicTeam as action208} from "@/app/settings/settings-extra-actions";
import {saveSettingsShortcuts as action209} from "@/app/settings/settings-extra-actions";
import {deleteUnusedRecordAction as action210} from "@/app/settings/delete-unused-action";
import {resetDirectStaffPasscode as action211} from "@/app/settings/direct-pos-actions";
import {saveDirectPortableAccess as action212} from "@/app/settings/direct-pos-actions";
import {saveDirectPosGroup as action213} from "@/app/settings/direct-pos-actions";
import {createPortablePosAccessAction as action214} from "@/app/pos/settings/actions";
import {savePosSettingsGroup as action215} from "@/app/pos/settings/actions";
import {updatePortablePosAccessCapabilitiesAction as action216} from "@/app/pos/settings/actions";
import {updatePortablePosAccessStatusAction as action217} from "@/app/pos/settings/actions";
import {secureRecoveryBackOfficeAccountAction as action218} from "@/app/settings/recovery-back-office/actions";
import {updateRecoveryBackOfficeCaseAction as action219} from "@/app/settings/recovery-back-office/actions";
import {updateRecoveryBackOfficeUserStatusAction as action220} from "@/app/settings/recovery-back-office/actions";
import {staffBookingPreferencesAction as action221} from "@/app/staff/appointments/staff-preferences-actions";
import {loadSettingsHub as action222} from "@/app/settings/settings-hub-actions";
import {createSupportRequest as action223} from "@/app/support/actions";
import {reopenContentReportReview as action224} from "@/app/support/actions";
import {sendGuestSupportMessage as action225} from "@/app/support/actions";
import {sendSupportMessage as action226} from "@/app/support/actions";
import {uploadSupportEvidence as action227} from "@/app/support/actions";
import {respondOwnerInvite as action228} from "@/app/my-place/owner-invite-actions";
import {applyToPlaceSalon as action229} from "@/app/my-place/actions";
import {createPlaceSalon as action230} from "@/app/my-place/actions";
import {getPlaceAccount as action231} from "@/app/my-place/actions";
import {getPlaceLifecycleReview as action232} from "@/app/my-place/actions";
import {getPlaceSalon as action233} from "@/app/my-place/actions";
import {respondPlaceRequest as action234} from "@/app/my-place/actions";
import {savePlaceLogo as action235} from "@/app/my-place/actions";
import {savePlaceMember as action236} from "@/app/my-place/actions";
import {savePlaceSalon as action237} from "@/app/my-place/actions";
import {searchPlaceSalons as action238} from "@/app/my-place/actions";
import {setPlaceSalonActivity as action239} from "@/app/my-place/actions";
import {closeCurrentSalonPermanentlyAction as action240} from "@/app/salon-settings/actions";
import {createCurrentSalonSpecialHoursAction as action241} from "@/app/salon-settings/actions";
import {deleteCurrentSalonSpecialHoursAction as action242} from "@/app/salon-settings/actions";
import {disableCurrentSalonAction as action243} from "@/app/salon-settings/actions";
import {generateCurrentSalonBackupAction as action244} from "@/app/salon-settings/actions";
import {reactivateCurrentSalonAction as action245} from "@/app/salon-settings/actions";
import {refreshSalonMapLocation as action246} from "@/app/salon-settings/actions";
import {updateSalonSettings as action247} from "@/app/salon-settings/actions";
import {updateStaffPublicTeamBatchAction as action248} from "@/app/salon-settings/actions";
import {leaveSalonOwnershipAction as action249} from "@/app/salon-settings/ownership-actions";
import {createSalonAction as action250} from "@/app/salons/actions";
import {setCurrentSalon as action251} from "@/app/salons/actions";
import {createCustomer as action252} from "@/app/customers/actions";
import {mergeDuplicateCustomers as action253} from "@/app/customers/actions";
import {updateCustomer as action254} from "@/app/customers/actions";
import {autosavePayrollPeriodStaffInputAction as action255} from "@/app/payroll/actions";
import {markLatestPayrollStatementPaidAction as action256} from "@/app/payroll/actions";
import {savePayrollStatementAction as action257} from "@/app/payroll/actions";
import {saveSalonPayrollScheduleAction as action258} from "@/app/payroll/actions";
import {saveStaffPayrollSettingWithEffectiveDateAction as action259} from "@/app/payroll/actions";
import {uploadPayrollPaystubAction as action260} from "@/app/payroll/actions";
import {rememberExplorePreferenceAction as action261} from "@/app/explore/actions";
import {toggleBeautyProfileFollowAction as action262} from "@/app/explore/actions";
import {confirmStaffAccountAccess as action263} from "@/app/staff/offline-binding-actions";
import {openAppNotificationAction as action264} from "@/app/notifications/actions";
import {runNotificationBookingAction as action265} from "@/app/notifications/actions";
import {downloadPayrollData as action266} from "@/app/payroll/data-download-actions";
import {connectTaxSalon as action267} from "@/app/tax-company/actions";
import {disconnectTaxSalon as action268} from "@/app/tax-company/actions";
import {saveTaxCompanyNote as action269} from "@/app/tax-company/actions";
import {updateTaxSettings as action270} from "@/app/tax-company/actions";
import {uploadTaxPaystub as action271} from "@/app/tax-company/actions";
import {acceptBeautySalonPublicationRequestAction as action272} from "@/app/salon-profile/client-transformations/actions";
import {declineBeautySalonPublicationRequestAction as action273} from "@/app/salon-profile/client-transformations/actions";
import {changeOwnerCampaignAction as action274} from "@/app/campaigns/actions";
import {createOwnerCampaignAction as action275} from "@/app/campaigns/actions";
import {dismissCampaignPromptAction as action276} from "@/app/campaigns/actions";
import {fundSavedCampaignAction as action277} from "@/app/campaigns/actions";
import {loadOwnerCampaignsAction as action278} from "@/app/campaigns/actions";
import {ownerCampaignPromptAction as action279} from "@/app/campaigns/actions";
import {loadCampaignResultsAction as action280} from "@/app/campaigns/actions";
import {saveCampaignLimitAction as action281} from "@/app/campaigns/actions";
import {loadCampaignPostsAction as action282} from "@/app/campaigns/actions";
import {createCampaignCreativeAction as action283} from "@/app/campaigns/creative-actions";
import {correctPortableClosedPosTicketInline as action284} from "@/app/pos/portable/actions";
import {getPortableTicketData as action285} from "@/app/pos/portable/actions";
import {logoutPortablePosAction as action286} from "@/app/pos/portable/actions";
import {portableAdjustStaffTurn as action287} from "@/app/pos/portable/actions";
import {portableBookingAppointments as action288} from "@/app/pos/portable/actions";
import {portableBookingHours as action289} from "@/app/pos/portable/actions";
import {portableBookingNotifications as action290} from "@/app/pos/portable/actions";
import {portableBookingSlots as action291} from "@/app/pos/portable/actions";
import {portableBookingStaffOptions as action292} from "@/app/pos/portable/actions";
import {portableCancelWaitingVisitForPos as action293} from "@/app/pos/portable/actions";
import {portableCreateAppointment as action294} from "@/app/pos/portable/actions";
import {portableCreatePosDeskCustomer as action295} from "@/app/pos/portable/actions";
import {portableGetPosLiveDraft as action296} from "@/app/pos/portable/actions";
import {portableLoadServiceRelay as action297} from "@/app/pos/portable/actions";
import {portableManageBooking as action298} from "@/app/pos/portable/actions";
import {portableResolveScannedCheckinReceipt as action299} from "@/app/pos/portable/actions";
import {portableSearchBookingCustomers as action300} from "@/app/pos/portable/actions";
import {portableSearchPosDeskCustomers as action301} from "@/app/pos/portable/actions";
import {portableSelectWaitingVisitForPos as action302} from "@/app/pos/portable/actions";
import {portableSubmitAttendanceEvent as action303} from "@/app/pos/portable/actions";
import {portableSubmitPosDeskReceipt as action304} from "@/app/pos/portable/actions";
import {portableSubmitServiceRelay as action305} from "@/app/pos/portable/actions";
import {portableUpdatePosActiveDraft as action306} from "@/app/pos/portable/actions";
import {portableUpdatePosLiveDraftCustomer as action307} from "@/app/pos/portable/actions";
import {savePortableReportClosing as action308} from "@/app/pos/portable/actions";
import {issueCheckinReceipt as action309} from "@/app/pos/checkin-receipt-actions";
import {saveOwnerAdjustment as action310} from "@/app/payroll/ledger-actions";
import {saveRecordedPayment as action311} from "@/app/payroll/ledger-actions";
import {verifyPayrollIntent as action312} from "@/app/payroll/ledger-actions";
import {loadPluginMarketStatusAction as action313} from "@/app/settings/plugin-market-status-actions";
import {loadBookingRulesSettingsAction as action314} from "@/app/settings/plugin-settings-actions";
import {saveBookingRulesSettingsAction as action315} from "@/app/settings/plugin-settings-actions";
import {loadBookSmsSettingsAction as action316} from "@/app/settings/plugin-settings-actions";
import {saveBookSmsSettingsAction as action317} from "@/app/settings/plugin-settings-actions";
import {loadCampaignPreviewAction as action318} from "@/app/campaigns/preview-actions";
const commands: Record<string,(values:unknown[])=>unknown>={
"action.cd9e45d5fdc4291bdc97f8ad": (values: unknown[]) => (action0 as unknown as (...args: unknown[]) => unknown)(...values),
"action.d06245d954e31f5b8be168de": (values: unknown[]) => (action1 as unknown as (...args: unknown[]) => unknown)(...values),
"action.8c6144966289f5c73446fee7": (values: unknown[]) => (action2 as unknown as (...args: unknown[]) => unknown)(...values),
"action.491f716a916c74d93c6523f0": (values: unknown[]) => (action3 as unknown as (...args: unknown[]) => unknown)(...values),
"action.c31772f1c4eca38298bbfdb3": (values: unknown[]) => (action4 as unknown as (...args: unknown[]) => unknown)(...values),
"action.38a40647dd7273051f3a4999": (values: unknown[]) => (action5 as unknown as (...args: unknown[]) => unknown)(...values),
"action.d84730935b14a9ad0d9d42ef": (values: unknown[]) => (action6 as unknown as (...args: unknown[]) => unknown)(...values),
"action.d18579cec4fb4921100be388": (values: unknown[]) => (action7 as unknown as (...args: unknown[]) => unknown)(...values),
"action.bb94214f0d3f0d2a38d0d32f": (values: unknown[]) => (action8 as unknown as (...args: unknown[]) => unknown)(...values),
"action.8f7e6d39a400851675090333": (values: unknown[]) => (action9 as unknown as (...args: unknown[]) => unknown)(...values),
"action.3e744ce93fbdc7844bc697ca": (values: unknown[]) => (action10 as unknown as (...args: unknown[]) => unknown)(...values),
"action.a341bbd6abe80a7668234095": (values: unknown[]) => (action11 as unknown as (...args: unknown[]) => unknown)(...values),
"action.ab56383965005dd3353e4520": (values: unknown[]) => (action12 as unknown as (...args: unknown[]) => unknown)(...values),
"action.e770a3b93f2aa6fefe139a12": (values: unknown[]) => (action13 as unknown as (...args: unknown[]) => unknown)(...values),
"action.9a768cd7fdcfcfe9372612ad": (values: unknown[]) => (action14 as unknown as (...args: unknown[]) => unknown)(...values),
"action.288ca4eaf71e6abc98f00c33": (values: unknown[]) => (action15 as unknown as (...args: unknown[]) => unknown)(...values),
"action.154e231a1efb12a7bf1b440a": (values: unknown[]) => (action16 as unknown as (...args: unknown[]) => unknown)(...values),
"action.8f9f0e42896e4b40830bf6d5": (values: unknown[]) => (action17 as unknown as (...args: unknown[]) => unknown)(...values),
"action.1e598d3e7e7b75c9591fde44": (values: unknown[]) => (action18 as unknown as (...args: unknown[]) => unknown)(...values),
"action.c677a7649dad82ced1d0102a": (values: unknown[]) => (action19 as unknown as (...args: unknown[]) => unknown)(...values),
"action.5290c94f98ce780e04f5d9ad": (values: unknown[]) => (action20 as unknown as (...args: unknown[]) => unknown)(...values),
"action.7b22c4f98645f7c6163afc37": (values: unknown[]) => (action21 as unknown as (...args: unknown[]) => unknown)(...values),
"action.1280e34d976480d359667a16": (values: unknown[]) => (action22 as unknown as (...args: unknown[]) => unknown)(...values),
"action.f65c8c8d814e8b9d4c3aa9e5": (values: unknown[]) => (action23 as unknown as (...args: unknown[]) => unknown)(...values),
"action.02955b8e7f91531436bbbd92": (values: unknown[]) => (action24 as unknown as (...args: unknown[]) => unknown)(...values),
"action.4937915331dbcee8bb3c0ff5": (values: unknown[]) => (action25 as unknown as (...args: unknown[]) => unknown)(...values),
"action.9a9014c676ca50443dc7f3ea": (values: unknown[]) => (action26 as unknown as (...args: unknown[]) => unknown)(...values),
"action.90a47ec81badef66ec80dbff": (values: unknown[]) => (action27 as unknown as (...args: unknown[]) => unknown)(...values),
"action.e404aa3754a10bffff3e3449": (values: unknown[]) => (action28 as unknown as (...args: unknown[]) => unknown)(...values),
"action.1ac5c3ea05df9a4c829c5e55": (values: unknown[]) => (action29 as unknown as (...args: unknown[]) => unknown)(...values),
"action.662559a52cd5701b9ed5af94": (values: unknown[]) => (action30 as unknown as (...args: unknown[]) => unknown)(...values),
"action.ce248b3cbade83d919554d57": (values: unknown[]) => (action31 as unknown as (...args: unknown[]) => unknown)(...values),
"action.d372a8c11a0583d7e14b4eed": (values: unknown[]) => (action32 as unknown as (...args: unknown[]) => unknown)(...values),
"action.fb30d5823882d36bc3f24687": (values: unknown[]) => (action33 as unknown as (...args: unknown[]) => unknown)(...values),
"action.39fb05170b4d6698f8e4975a": (values: unknown[]) => (action34 as unknown as (...args: unknown[]) => unknown)(...values),
"action.923f39628506a8bdc1959964": (values: unknown[]) => (action35 as unknown as (...args: unknown[]) => unknown)(...values),
"action.8120079bcf1ba0d1a0b48903": (values: unknown[]) => (action36 as unknown as (...args: unknown[]) => unknown)(...values),
"action.c8d2ed912253a2a9ca0a0122": (values: unknown[]) => (action37 as unknown as (...args: unknown[]) => unknown)(...values),
"action.f163b47a84a728e4f33c02c8": (values: unknown[]) => (action38 as unknown as (...args: unknown[]) => unknown)(...values),
"action.4c40f10ecae1f17754e89644": (values: unknown[]) => (action39 as unknown as (...args: unknown[]) => unknown)(...values),
"action.cfb8b4aa13248633447f49bd": (values: unknown[]) => (action40 as unknown as (...args: unknown[]) => unknown)(...values),
"action.f99b2c814cccbda46ac25ce1": (values: unknown[]) => (action41 as unknown as (...args: unknown[]) => unknown)(...values),
"action.a8d52f428a77d59ed32412d1": (values: unknown[]) => (action42 as unknown as (...args: unknown[]) => unknown)(...values),
"action.ccbccf17275333ff61b5ce2c": (values: unknown[]) => (action43 as unknown as (...args: unknown[]) => unknown)(...values),
"action.4ff7e121d64b42b9f97b3182": (values: unknown[]) => (action44 as unknown as (...args: unknown[]) => unknown)(...values),
"action.e99bfbac281b2f0040bd797b": (values: unknown[]) => (action45 as unknown as (...args: unknown[]) => unknown)(...values),
"action.911d2ccb0632ffea258384de": (values: unknown[]) => (action46 as unknown as (...args: unknown[]) => unknown)(...values),
"action.80572fb89ff72f23c1192523": (values: unknown[]) => (action47 as unknown as (...args: unknown[]) => unknown)(...values),
"action.125ecdd528c2160f9bc23c90": (values: unknown[]) => (action48 as unknown as (...args: unknown[]) => unknown)(...values),
"action.dc79aee24bdbcf715ad1ddeb": (values: unknown[]) => (action49 as unknown as (...args: unknown[]) => unknown)(...values),
"action.bbb59baefab3741154789163": (values: unknown[]) => (action50 as unknown as (...args: unknown[]) => unknown)(...values),
"action.a06d5a6b1fadcb4acf5e751f": (values: unknown[]) => (action51 as unknown as (...args: unknown[]) => unknown)(...values),
"action.73cb3c0c50601c0fbdfd99eb": (values: unknown[]) => (action52 as unknown as (...args: unknown[]) => unknown)(...values),
"action.98eb8d678c30460a4b49a5d6": (values: unknown[]) => (action53 as unknown as (...args: unknown[]) => unknown)(...values),
"action.c2f9d5d2b7eee4a4fbcee253": (values: unknown[]) => (action54 as unknown as (...args: unknown[]) => unknown)(...values),
"action.ef3781c2eb3fbba71f06f6de": (values: unknown[]) => (action55 as unknown as (...args: unknown[]) => unknown)(...values),
"action.2f6f64620a3c5535b79da7d5": (values: unknown[]) => (action56 as unknown as (...args: unknown[]) => unknown)(...values),
"action.2b1c614855accebcb89d4505": (values: unknown[]) => (action57 as unknown as (...args: unknown[]) => unknown)(...values),
"action.d29d025153b49ac81fca2aba": (values: unknown[]) => (action58 as unknown as (...args: unknown[]) => unknown)(...values),
"action.f1ab2af7bd060171cbfba827": (values: unknown[]) => (action59 as unknown as (...args: unknown[]) => unknown)(...values),
"action.2ff1ef437bd70a49370b307e": (values: unknown[]) => (action60 as unknown as (...args: unknown[]) => unknown)(...values),
"action.2fee1d2ec30604149c8f4bd9": (values: unknown[]) => (action61 as unknown as (...args: unknown[]) => unknown)(...values),
"action.c513c234cea367b151cb0cf9": (values: unknown[]) => (action62 as unknown as (...args: unknown[]) => unknown)(...values),
"action.caa814d3b87b7fcc1c594cee": (values: unknown[]) => (action63 as unknown as (...args: unknown[]) => unknown)(...values),
"action.3b5814b81376b29b6f702b6d": (values: unknown[]) => (action64 as unknown as (...args: unknown[]) => unknown)(...values),
"action.fd4b1f4bbd588ce73ad2337f": (values: unknown[]) => (action65 as unknown as (...args: unknown[]) => unknown)(...values),
"action.6bfdf471a2501181af6c6733": (values: unknown[]) => (action66 as unknown as (...args: unknown[]) => unknown)(...values),
"action.c273b009a9fe8b00d661599f": (values: unknown[]) => (action67 as unknown as (...args: unknown[]) => unknown)(...values),
"action.43ea35bd7c39ad42537645b5": (values: unknown[]) => (action68 as unknown as (...args: unknown[]) => unknown)(...values),
"action.b6594f88d6d87bc27091d2a7": (values: unknown[]) => (action69 as unknown as (...args: unknown[]) => unknown)(...values),
"action.b6d72cbaa3b9944ef2e7eb67": (values: unknown[]) => (action70 as unknown as (...args: unknown[]) => unknown)(...values),
"action.6ab67ce57face0c17c6ca51b": (values: unknown[]) => (action71 as unknown as (...args: unknown[]) => unknown)(...values),
"action.65f6ddfec4bcc7176c3f7202": (values: unknown[]) => (action72 as unknown as (...args: unknown[]) => unknown)(...values),
"action.40084b43686b6b73dc4dc79b": (values: unknown[]) => (action73 as unknown as (...args: unknown[]) => unknown)(...values),
"action.cb1c59ec1593cd442d3308b6": (values: unknown[]) => (action74 as unknown as (...args: unknown[]) => unknown)(...values),
"action.36b2f4cad54893e52ab798a1": (values: unknown[]) => (action75 as unknown as (...args: unknown[]) => unknown)(...values),
"action.d94d6b6fffa7661a78432671": (values: unknown[]) => (action76 as unknown as (...args: unknown[]) => unknown)(...values),
"action.147475f1747e29fc780d6db7": (values: unknown[]) => (action77 as unknown as (...args: unknown[]) => unknown)(...values),
"action.7fe4e45b099411edb1ef649d": (values: unknown[]) => (action78 as unknown as (...args: unknown[]) => unknown)(...values),
"action.2d917d2c3d746842918f595d": (values: unknown[]) => (action79 as unknown as (...args: unknown[]) => unknown)(...values),
"action.a6b9d77f7d5ddbff1458f2b2": (values: unknown[]) => (action80 as unknown as (...args: unknown[]) => unknown)(...values),
"action.2de2a16fcf121489467bd99a": (values: unknown[]) => (action81 as unknown as (...args: unknown[]) => unknown)(...values),
"action.b230f0fee30cdc438f5883a2": (values: unknown[]) => (action82 as unknown as (...args: unknown[]) => unknown)(...values),
"action.8e15707f4f804f1d6aefafb9": (values: unknown[]) => (action83 as unknown as (...args: unknown[]) => unknown)(...values),
"action.cbc887d5f2340a7ec02fba0d": (values: unknown[]) => (action84 as unknown as (...args: unknown[]) => unknown)(...values),
"action.585d774096576fe78b903850": (values: unknown[]) => (action85 as unknown as (...args: unknown[]) => unknown)(...values),
"action.df095b8f4d9c78a567439f03": (values: unknown[]) => (action86 as unknown as (...args: unknown[]) => unknown)(...values),
"action.a0d827a7eb03ab154db34ed9": (values: unknown[]) => (action87 as unknown as (...args: unknown[]) => unknown)(...values),
"action.fa47cb6d9b9e74c636dadda2": (values: unknown[]) => (action88 as unknown as (...args: unknown[]) => unknown)(...values),
"action.2f1772afceae92f622cc744c": (values: unknown[]) => (action89 as unknown as (...args: unknown[]) => unknown)(...values),
"action.f030b83763df0d3a018fa523": (values: unknown[]) => (action90 as unknown as (...args: unknown[]) => unknown)(...values),
"action.ccd6694994f2fca12f020a21": (values: unknown[]) => (action91 as unknown as (...args: unknown[]) => unknown)(...values),
"action.9f4574903e4b0d84c3f21dd4": (values: unknown[]) => (action92 as unknown as (...args: unknown[]) => unknown)(...values),
"action.48d0286b2a5b8fe16774b1bc": (values: unknown[]) => (action93 as unknown as (...args: unknown[]) => unknown)(...values),
"action.5bc6ad9fa5b2286d232b6b14": (values: unknown[]) => (action94 as unknown as (...args: unknown[]) => unknown)(...values),
"action.10c7ea9233a347f690a1f7c2": (values: unknown[]) => (action95 as unknown as (...args: unknown[]) => unknown)(...values),
"action.d4232c01e7a0463f4a4cb64a": (values: unknown[]) => (action96 as unknown as (...args: unknown[]) => unknown)(...values),
"action.4502f3c187bec77327a67027": (values: unknown[]) => (action97 as unknown as (...args: unknown[]) => unknown)(...values),
"action.5d11cb006df637ddf886c2f3": (values: unknown[]) => (action98 as unknown as (...args: unknown[]) => unknown)(...values),
"action.efc196d40c1355cb97795327": (values: unknown[]) => (action99 as unknown as (...args: unknown[]) => unknown)(...values),
"action.2c9c7c649d9121c6b430132a": (values: unknown[]) => (action100 as unknown as (...args: unknown[]) => unknown)(...values),
"action.bfa75635bb73f19d9bebb95a": (values: unknown[]) => (action101 as unknown as (...args: unknown[]) => unknown)(...values),
"action.9b6c85e463ddea88607aa2e0": (values: unknown[]) => (action102 as unknown as (...args: unknown[]) => unknown)(...values),
"action.895262798ea1dce5bbde13b6": (values: unknown[]) => (action103 as unknown as (...args: unknown[]) => unknown)(...values),
"action.d0fa95b0f3376950cec2b4da": (values: unknown[]) => (action104 as unknown as (...args: unknown[]) => unknown)(...values),
"action.9abfdadd0e98c80705d212f8": (values: unknown[]) => (action105 as unknown as (...args: unknown[]) => unknown)(...values),
"action.31a5721011b4449a649d96d9": (values: unknown[]) => (action106 as unknown as (...args: unknown[]) => unknown)(...values),
"action.feaf50863708b882d73df6bb": (values: unknown[]) => (action107 as unknown as (...args: unknown[]) => unknown)(...values),
"action.54da5d1347af7999836448bf": (values: unknown[]) => (action108 as unknown as (...args: unknown[]) => unknown)(...values),
"action.7854dd5191eae68f4d73b6a8": (values: unknown[]) => (action109 as unknown as (...args: unknown[]) => unknown)(...values),
"action.045fc806fa064066635efc39": (values: unknown[]) => (action110 as unknown as (...args: unknown[]) => unknown)(...values),
"action.811cc7795324663f73872d92": (values: unknown[]) => (action111 as unknown as (...args: unknown[]) => unknown)(...values),
"action.7961ac2c910f7a2067d2f4a4": (values: unknown[]) => (action112 as unknown as (...args: unknown[]) => unknown)(...values),
"action.153a120996d5378acd17b4d7": (values: unknown[]) => (action113 as unknown as (...args: unknown[]) => unknown)(...values),
"action.772cdac11ef85b024329a565": (values: unknown[]) => (action114 as unknown as (...args: unknown[]) => unknown)(...values),
"action.2e29abd92df58ad9b2be813b": (values: unknown[]) => (action115 as unknown as (...args: unknown[]) => unknown)(...values),
"action.69a2c74fd5803838e297d374": (values: unknown[]) => (action116 as unknown as (...args: unknown[]) => unknown)(...values),
"action.2895f09934e6d0b1831afc8f": (values: unknown[]) => (action117 as unknown as (...args: unknown[]) => unknown)(...values),
"action.338b77bfc26559632fe1c407": (values: unknown[]) => (action118 as unknown as (...args: unknown[]) => unknown)(...values),
"action.0f711abcc9ae6349a5050205": (values: unknown[]) => (action119 as unknown as (...args: unknown[]) => unknown)(...values),
"action.e5c1fe6ebefb482edc4a1ddf": (values: unknown[]) => (action120 as unknown as (...args: unknown[]) => unknown)(...values),
"action.4addf9da8f41cb5db8e9cfc0": (values: unknown[]) => (action121 as unknown as (...args: unknown[]) => unknown)(...values),
"action.89a73524f42b8fa39269faa8": (values: unknown[]) => (action122 as unknown as (...args: unknown[]) => unknown)(...values),
"action.9adc68948447bec8b29a9131": (values: unknown[]) => (action123 as unknown as (...args: unknown[]) => unknown)(...values),
"action.d79109dc36c7fc0fc6ad0bdc": (values: unknown[]) => (action124 as unknown as (...args: unknown[]) => unknown)(...values),
"action.bcd8e6bbb80bf3563d0ee9bc": (values: unknown[]) => (action125 as unknown as (...args: unknown[]) => unknown)(...values),
"action.6f41695c27a66fa75c9c02e7": (values: unknown[]) => (action126 as unknown as (...args: unknown[]) => unknown)(...values),
"action.5041cef8ca37ef016a7fc9cd": (values: unknown[]) => (action127 as unknown as (...args: unknown[]) => unknown)(...values),
"action.427b872b42d18da1a038c5e3": (values: unknown[]) => (action128 as unknown as (...args: unknown[]) => unknown)(...values),
"action.d7a13ea8ac314a10a1929d50": (values: unknown[]) => (action129 as unknown as (...args: unknown[]) => unknown)(...values),
"action.104aa6ce78b263569b2f6d59": (values: unknown[]) => (action130 as unknown as (...args: unknown[]) => unknown)(...values),
"action.57b3af811bc182f185af8788": (values: unknown[]) => (action131 as unknown as (...args: unknown[]) => unknown)(...values),
"action.bf1d73e6c144acfd6d7de892": (values: unknown[]) => (action132 as unknown as (...args: unknown[]) => unknown)(...values),
"action.e17521b389c256c86c8a2694": (values: unknown[]) => (action133 as unknown as (...args: unknown[]) => unknown)(...values),
"action.361866e4f3fe481645af55b8": (values: unknown[]) => (action134 as unknown as (...args: unknown[]) => unknown)(...values),
"action.1bbc090e1fab7a9ed086799d": (values: unknown[]) => (action135 as unknown as (...args: unknown[]) => unknown)(...values),
"action.185507fa17438136f09c6554": (values: unknown[]) => (action136 as unknown as (...args: unknown[]) => unknown)(...values),
"action.3ead20083986204316cb0419": (values: unknown[]) => (action137 as unknown as (...args: unknown[]) => unknown)(...values),
"action.df8434167ea70164fb74f8e5": (values: unknown[]) => (action138 as unknown as (...args: unknown[]) => unknown)(...values),
"action.799fd30bf3d361ae76c3a8e3": (values: unknown[]) => (action139 as unknown as (...args: unknown[]) => unknown)(...values),
"action.398e36477969b82a42384575": (values: unknown[]) => (action140 as unknown as (...args: unknown[]) => unknown)(...values),
"action.90a2646a492d211f36c5b65c": (values: unknown[]) => (action141 as unknown as (...args: unknown[]) => unknown)(...values),
"action.a9640f09af0496a08482250b": (values: unknown[]) => (action142 as unknown as (...args: unknown[]) => unknown)(...values),
"action.3335be22a24981caae800954": (values: unknown[]) => (action143 as unknown as (...args: unknown[]) => unknown)(...values),
"action.4f494950db0bb4811d70f618": (values: unknown[]) => (action144 as unknown as (...args: unknown[]) => unknown)(...values),
"action.a76d34dc391ae49c4dc3702c": (values: unknown[]) => (action145 as unknown as (...args: unknown[]) => unknown)(...values),
"action.d44dd2450113525c84d6cf0f": (values: unknown[]) => (action146 as unknown as (...args: unknown[]) => unknown)(...values),
"action.af480cecbd2e5eb3b0026449": (values: unknown[]) => (action147 as unknown as (...args: unknown[]) => unknown)(...values),
"action.388657dfb959c8c94466d163": (values: unknown[]) => (action148 as unknown as (...args: unknown[]) => unknown)(...values),
"action.674b56080b66ad34bd271918": (values: unknown[]) => (action149 as unknown as (...args: unknown[]) => unknown)(...values),
"action.51dfd39daf6d6d169826db73": (values: unknown[]) => (action150 as unknown as (...args: unknown[]) => unknown)(...values),
"action.c3cf6ec7361ef26fc530abbf": (values: unknown[]) => (action151 as unknown as (...args: unknown[]) => unknown)(...values),
"action.f47992eae0ec8ee25a996eb4": (values: unknown[]) => (action152 as unknown as (...args: unknown[]) => unknown)(...values),
"action.8d6b32c3c4b4c3261a3cd54e": (values: unknown[]) => (action153 as unknown as (...args: unknown[]) => unknown)(...values),
"action.008a1121f46e0ac4a0ab1db1": (values: unknown[]) => (action154 as unknown as (...args: unknown[]) => unknown)(...values),
"action.cb4fc917c237ffe99a67651e": (values: unknown[]) => (action155 as unknown as (...args: unknown[]) => unknown)(...values),
"action.b1f3594694b500e99371210b": (values: unknown[]) => (action156 as unknown as (...args: unknown[]) => unknown)(...values),
"action.dbd36b5b42d7ff634a5ed312": (values: unknown[]) => (action157 as unknown as (...args: unknown[]) => unknown)(...values),
"action.177d9c8d4485049b7e410ae0": (values: unknown[]) => (action158 as unknown as (...args: unknown[]) => unknown)(...values),
"action.bebbbf3c1ca953cb536c0e80": (values: unknown[]) => (action159 as unknown as (...args: unknown[]) => unknown)(...values),
"action.8d1ed81931b6e82cf5f39f77": (values: unknown[]) => (action160 as unknown as (...args: unknown[]) => unknown)(...values),
"action.32c5f03cf83e64b4e3d1a51a": (values: unknown[]) => (action161 as unknown as (...args: unknown[]) => unknown)(...values),
"action.91dc00903a8d9fad5bc54c0e": (values: unknown[]) => (action162 as unknown as (...args: unknown[]) => unknown)(...values),
"action.b6ed9b024aca62f575126e69": (values: unknown[]) => (action163 as unknown as (...args: unknown[]) => unknown)(...values),
"action.60c6b06e3d7f1735af4b4907": (values: unknown[]) => (action164 as unknown as (...args: unknown[]) => unknown)(...values),
"action.9455213d450ca82fa784eb75": (values: unknown[]) => (action165 as unknown as (...args: unknown[]) => unknown)(...values),
"action.93cd826230bef6c22e492cc2": (values: unknown[]) => (action166 as unknown as (...args: unknown[]) => unknown)(...values),
"action.527c0c2642a54a88fc220736": (values: unknown[]) => (action167 as unknown as (...args: unknown[]) => unknown)(...values),
"action.7740809d8af93808ca51efd7": (values: unknown[]) => (action168 as unknown as (...args: unknown[]) => unknown)(...values),
"action.02852af1b51b335acd621aa7": (values: unknown[]) => (action169 as unknown as (...args: unknown[]) => unknown)(...values),
"action.3ddb57365702b954b07bfcba": (values: unknown[]) => (action170 as unknown as (...args: unknown[]) => unknown)(...values),
"action.48ff31f3dc27bfba9839d91e": (values: unknown[]) => (action171 as unknown as (...args: unknown[]) => unknown)(...values),
"action.6dd014f02b1a38d7ace645b2": (values: unknown[]) => (action172 as unknown as (...args: unknown[]) => unknown)(...values),
"action.805a8e77dd5fc4af68d0ac5c": (values: unknown[]) => (action173 as unknown as (...args: unknown[]) => unknown)(...values),
"action.c7dcbfbf7aeb16d364d0321a": (values: unknown[]) => (action174 as unknown as (...args: unknown[]) => unknown)(...values),
"action.f09c3c0aab5d772b1b2e8b21": (values: unknown[]) => (action175 as unknown as (...args: unknown[]) => unknown)(...values),
"action.824f99ec97375ddc2c4a2f4a": (values: unknown[]) => (action176 as unknown as (...args: unknown[]) => unknown)(...values),
"action.f4f4c3af1540449da2953dbc": (values: unknown[]) => (action177 as unknown as (...args: unknown[]) => unknown)(...values),
"action.978c6e7fae8c6123fea05a78": (values: unknown[]) => (action178 as unknown as (...args: unknown[]) => unknown)(...values),
"action.2d5d05c5cbef23fbcffb8f34": (values: unknown[]) => (action179 as unknown as (...args: unknown[]) => unknown)(...values),
"action.4aaa9090f504571694158977": (values: unknown[]) => (action180 as unknown as (...args: unknown[]) => unknown)(...values),
"action.df7703d2d3f5bd5171e9895b": (values: unknown[]) => (action181 as unknown as (...args: unknown[]) => unknown)(...values),
"action.dfbd0ef1bedbce850df01029": (values: unknown[]) => (action182 as unknown as (...args: unknown[]) => unknown)(...values),
"action.6ab54832a69c8bec098e9dd2": (values: unknown[]) => (action183 as unknown as (...args: unknown[]) => unknown)(...values),
"action.0c16dc7adfe10a4abf0eb3cd": (values: unknown[]) => (action184 as unknown as (...args: unknown[]) => unknown)(...values),
"action.7a7fbe242d487bc5537b907d": (values: unknown[]) => (action185 as unknown as (...args: unknown[]) => unknown)(...values),
"action.691278ea4f3fecddeb802668": (values: unknown[]) => (action186 as unknown as (...args: unknown[]) => unknown)(...values),
"action.0033ad6758bbc0015a26a901": (values: unknown[]) => (action187 as unknown as (...args: unknown[]) => unknown)(...values),
"action.f43d51531c07527d3a5f5c12": (values: unknown[]) => (action188 as unknown as (...args: unknown[]) => unknown)(...values),
"action.b0a00bd67f29e0624454828d": (values: unknown[]) => (action189 as unknown as (...args: unknown[]) => unknown)(...values),
"action.7bad2f653b11224353df34f3": (values: unknown[]) => (action190 as unknown as (...args: unknown[]) => unknown)(...values),
"action.85186aff501259dbe8342b90": (values: unknown[]) => (action191 as unknown as (...args: unknown[]) => unknown)(...values),
"action.f800612a0d9d66f726d969d2": (values: unknown[]) => (action192 as unknown as (...args: unknown[]) => unknown)(...values),
"action.825603ad31c4241a9c79b42c": (values: unknown[]) => (action193 as unknown as (...args: unknown[]) => unknown)(...values),
"action.a8f1c838509e61d9f044b61c": (values: unknown[]) => (action194 as unknown as (...args: unknown[]) => unknown)(...values),
"action.92d145c80e5f9d463eca943b": (values: unknown[]) => (action195 as unknown as (...args: unknown[]) => unknown)(...values),
"action.cc2d6383a9be0f5bc0c73073": (values: unknown[]) => (action196 as unknown as (...args: unknown[]) => unknown)(...values),
"action.42ccd944a3464d4808044597": (values: unknown[]) => (action197 as unknown as (...args: unknown[]) => unknown)(...values),
"action.c6373d95c41587e9ba708a5f": (values: unknown[]) => (action198 as unknown as (...args: unknown[]) => unknown)(...values),
"action.4c6503087b4c6812381e3af0": (values: unknown[]) => (action199 as unknown as (...args: unknown[]) => unknown)(...values),
"action.7bb22aeea8fa8b285822e26b": (values: unknown[]) => (action200 as unknown as (...args: unknown[]) => unknown)(...values),
"action.554b39a5b738a00fd864175d": (values: unknown[]) => (action201 as unknown as (...args: unknown[]) => unknown)(...values),
"action.3bfa142e6386689d39bc253a": (values: unknown[]) => (action202 as unknown as (...args: unknown[]) => unknown)(...values),
"action.f49fa1248a6270a7292cfcda": (values: unknown[]) => (action203 as unknown as (...args: unknown[]) => unknown)(...values),
"action.9ec50f3f74c8abe1ac65f6e3": (values: unknown[]) => (action204 as unknown as (...args: unknown[]) => unknown)(...values),
"action.76fe184982c90e34cb21867d": (values: unknown[]) => (action205 as unknown as (...args: unknown[]) => unknown)(...values),
"action.a470bb83c15ca277ab34889f": (values: unknown[]) => (action206 as unknown as (...args: unknown[]) => unknown)(...values),
"action.348082c78adb64873e61d50b": (values: unknown[]) => (action207 as unknown as (...args: unknown[]) => unknown)(...values),
"action.8ceaef1ec1863395c19e2f05": (values: unknown[]) => (action208 as unknown as (...args: unknown[]) => unknown)(...values),
"action.3bf40a20a61957f10b42d982": (values: unknown[]) => (action209 as unknown as (...args: unknown[]) => unknown)(...values),
"action.97e2ca534aca481ad4abaf45": (values: unknown[]) => (action210 as unknown as (...args: unknown[]) => unknown)(...values),
"action.f52ca58649ae708196149daa": (values: unknown[]) => (action211 as unknown as (...args: unknown[]) => unknown)(...values),
"action.4840ec3df9733a94d4916d0f": (values: unknown[]) => (action212 as unknown as (...args: unknown[]) => unknown)(...values),
"action.86840100cd75a8758ff84961": (values: unknown[]) => (action213 as unknown as (...args: unknown[]) => unknown)(...values),
"action.f0183755b41ce958178dcfd5": (values: unknown[]) => (action214 as unknown as (...args: unknown[]) => unknown)(...values),
"action.0b1e0a58e14816ae5b2c1e9a": (values: unknown[]) => (action215 as unknown as (...args: unknown[]) => unknown)(...values),
"action.7855235fbaecc8c8cf078e80": (values: unknown[]) => (action216 as unknown as (...args: unknown[]) => unknown)(...values),
"action.8a3d20bfd007c6b1453dd008": (values: unknown[]) => (action217 as unknown as (...args: unknown[]) => unknown)(...values),
"action.148422b26966c4d68dfee682": (values: unknown[]) => (action218 as unknown as (...args: unknown[]) => unknown)(...values),
"action.2cc3e151abe07fe32f0bb1e4": (values: unknown[]) => (action219 as unknown as (...args: unknown[]) => unknown)(...values),
"action.6d392c78c83274cd84290218": (values: unknown[]) => (action220 as unknown as (...args: unknown[]) => unknown)(...values),
"action.e0f4858c1586bf24d5c7dc84": (values: unknown[]) => (action221 as unknown as (...args: unknown[]) => unknown)(...values),
"action.7421045de9e57e32677f2184": (values: unknown[]) => (action222 as unknown as (...args: unknown[]) => unknown)(...values),
"action.c004a697911655938eaaa101": (values: unknown[]) => (action223 as unknown as (...args: unknown[]) => unknown)(...values),
"action.c99c554720d56914bc1385e8": (values: unknown[]) => (action224 as unknown as (...args: unknown[]) => unknown)(...values),
"action.2cc752fbcff2cf74bddc5ffc": (values: unknown[]) => (action225 as unknown as (...args: unknown[]) => unknown)(...values),
"action.78a6a43f5062627c5560401f": (values: unknown[]) => (action226 as unknown as (...args: unknown[]) => unknown)(...values),
"action.8bf63c94a49e4c5fa9fe2817": (values: unknown[]) => (action227 as unknown as (...args: unknown[]) => unknown)(...values),
"action.cb13ebe7eac233aa0063b607": (values: unknown[]) => (action228 as unknown as (...args: unknown[]) => unknown)(...values),
"action.8cf74eab6ba13a0f0ea381a3": (values: unknown[]) => (action229 as unknown as (...args: unknown[]) => unknown)(...values),
"action.fcdf2e7d99b39d1c4db8a003": (values: unknown[]) => (action230 as unknown as (...args: unknown[]) => unknown)(...values),
"action.b0421b12e1d97957a2d9f88f": (values: unknown[]) => (action231 as unknown as (...args: unknown[]) => unknown)(...values),
"action.2cd93ae8c99ed4cd17ac7ba8": (values: unknown[]) => (action232 as unknown as (...args: unknown[]) => unknown)(...values),
"action.738e70cf8751b3ef67c18a4f": (values: unknown[]) => (action233 as unknown as (...args: unknown[]) => unknown)(...values),
"action.47fe4e766d6f7b1604fbbbf5": (values: unknown[]) => (action234 as unknown as (...args: unknown[]) => unknown)(...values),
"action.3ac9987997bdf89a42c1c9cb": (values: unknown[]) => (action235 as unknown as (...args: unknown[]) => unknown)(...values),
"action.0f14b7b530906a88e02dbc94": (values: unknown[]) => (action236 as unknown as (...args: unknown[]) => unknown)(...values),
"action.9fd336c4ed9fde63fc1018a7": (values: unknown[]) => (action237 as unknown as (...args: unknown[]) => unknown)(...values),
"action.2e4fb88e63ddce69d92f7d39": (values: unknown[]) => (action238 as unknown as (...args: unknown[]) => unknown)(...values),
"action.c938c496d6ab48f45d4cd0e0": (values: unknown[]) => (action239 as unknown as (...args: unknown[]) => unknown)(...values),
"action.b4f7fee0733bda6dd9ed9d20": (values: unknown[]) => (action240 as unknown as (...args: unknown[]) => unknown)(...values),
"action.e0d374c1726cbbd6f12f70c9": (values: unknown[]) => (action241 as unknown as (...args: unknown[]) => unknown)(...values),
"action.f46bef51991e77f23bb9e8a5": (values: unknown[]) => (action242 as unknown as (...args: unknown[]) => unknown)(...values),
"action.91c83c32fc47ef4896ce524b": (values: unknown[]) => (action243 as unknown as (...args: unknown[]) => unknown)(...values),
"action.21f97cf3eddd78bc22de9c23": (values: unknown[]) => (action244 as unknown as (...args: unknown[]) => unknown)(...values),
"action.58b59a8a8771f1228fa5cd60": (values: unknown[]) => (action245 as unknown as (...args: unknown[]) => unknown)(...values),
"action.8be7bf84ff8fb6f897fd884d": (values: unknown[]) => (action246 as unknown as (...args: unknown[]) => unknown)(...values),
"action.f1a8a4d76e98b29494cf02b1": (values: unknown[]) => (action247 as unknown as (...args: unknown[]) => unknown)(...values),
"action.8f157255a920779473921117": (values: unknown[]) => (action248 as unknown as (...args: unknown[]) => unknown)(...values),
"action.4fefd2e488e7935d48711994": (values: unknown[]) => (action249 as unknown as (...args: unknown[]) => unknown)(...values),
"action.679e3f19640c070acd05fa0b": (values: unknown[]) => (action250 as unknown as (...args: unknown[]) => unknown)(...values),
"action.f72f2736bc2b4a4b67e4427d": (values: unknown[]) => (action251 as unknown as (...args: unknown[]) => unknown)(...values),
"action.7607cb1fb252b8d6ed53be98": (values: unknown[]) => (action252 as unknown as (...args: unknown[]) => unknown)(...values),
"action.31c0ae2688c16a3f26bff44e": (values: unknown[]) => (action253 as unknown as (...args: unknown[]) => unknown)(...values),
"action.ef89640c5a541203067e783a": (values: unknown[]) => (action254 as unknown as (...args: unknown[]) => unknown)(...values),
"action.ef6399bcf1eddc328eb44797": (values: unknown[]) => (action255 as unknown as (...args: unknown[]) => unknown)(...values),
"action.b5b64d90f59ce6877ece778a": (values: unknown[]) => (action256 as unknown as (...args: unknown[]) => unknown)(...values),
"action.a890d694f2aca2511bb67039": (values: unknown[]) => (action257 as unknown as (...args: unknown[]) => unknown)(...values),
"action.c0bb39386d1a305646380e0b": (values: unknown[]) => (action258 as unknown as (...args: unknown[]) => unknown)(...values),
"action.ba18d75b34029fc53e80470b": (values: unknown[]) => (action259 as unknown as (...args: unknown[]) => unknown)(...values),
"action.54072c2407a11cc75bd91fe7": (values: unknown[]) => (action260 as unknown as (...args: unknown[]) => unknown)(...values),
"action.ed1af3e056bd899837687d6f": (values: unknown[]) => (action261 as unknown as (...args: unknown[]) => unknown)(...values),
"action.ff25d55a5fc31b661bcf3275": (values: unknown[]) => (action262 as unknown as (...args: unknown[]) => unknown)(...values),
"action.37e2e1f79d45912d6b2af4f1": (values: unknown[]) => (action263 as unknown as (...args: unknown[]) => unknown)(...values),
"action.a8527452c40f032c2c2f683c": (values: unknown[]) => (action264 as unknown as (...args: unknown[]) => unknown)(...values),
"action.c1d80e9ad712381210d676e8": (values: unknown[]) => (action265 as unknown as (...args: unknown[]) => unknown)(...values),
"action.28078aa8561c157e9b45c7b7": (values: unknown[]) => (action266 as unknown as (...args: unknown[]) => unknown)(...values),
"action.cdf06dd2801e948acf28a01f": (values: unknown[]) => (action267 as unknown as (...args: unknown[]) => unknown)(...values),
"action.4119499ccbab7ccf2ffd2d33": (values: unknown[]) => (action268 as unknown as (...args: unknown[]) => unknown)(...values),
"action.eff48cf4c7e753de7c119c6b": (values: unknown[]) => (action269 as unknown as (...args: unknown[]) => unknown)(...values),
"action.08072b94c3dd3f5b1d6154ab": (values: unknown[]) => (action270 as unknown as (...args: unknown[]) => unknown)(...values),
"action.805ee4ab28a6954dd0389212": (values: unknown[]) => (action271 as unknown as (...args: unknown[]) => unknown)(...values),
"action.f2e75fe0fff43ccafa597013": (values: unknown[]) => (action272 as unknown as (...args: unknown[]) => unknown)(...values),
"action.f6c9fc9f70a538ca476fd067": (values: unknown[]) => (action273 as unknown as (...args: unknown[]) => unknown)(...values),
"action.393ea0f1c971c7c63be45469": (values: unknown[]) => (action274 as unknown as (...args: unknown[]) => unknown)(...values),
"action.76baa008cdde8ba0dbb909e4": (values: unknown[]) => (action275 as unknown as (...args: unknown[]) => unknown)(...values),
"action.aea9486dc01af87281803902": (values: unknown[]) => (action276 as unknown as (...args: unknown[]) => unknown)(...values),
"action.6e26f508d8f1900bf1b294ee": (values: unknown[]) => (action277 as unknown as (...args: unknown[]) => unknown)(...values),
"action.dc68d24d69dfd38458d98c38": (values: unknown[]) => (action278 as unknown as (...args: unknown[]) => unknown)(...values),
"action.43868b737ff7fd87908af008": (values: unknown[]) => (action279 as unknown as (...args: unknown[]) => unknown)(...values),
"action.e9bf91eb64c76739dbe11c91": (values: unknown[]) => (action280 as unknown as (...args: unknown[]) => unknown)(...values),
"action.6ee6652b9246e7b981bbf46b": (values: unknown[]) => (action281 as unknown as (...args: unknown[]) => unknown)(...values),
"action.ffb7ca22ac735acf50557145": (values: unknown[]) => (action282 as unknown as (...args: unknown[]) => unknown)(...values),
"action.ee11d447d1154d3e1ff376fb": (values: unknown[]) => (action283 as unknown as (...args: unknown[]) => unknown)(...values),
"action.df00c997ca86dc0f6e4d98f4": (values: unknown[]) => (action284 as unknown as (...args: unknown[]) => unknown)(...values),
"action.51689e3f85764b80e1cc4826": (values: unknown[]) => (action285 as unknown as (...args: unknown[]) => unknown)(...values),
"action.2e671786f0d60d166a740406": (values: unknown[]) => (action286 as unknown as (...args: unknown[]) => unknown)(...values),
"action.873dd44c9cae0c2e2c122111": (values: unknown[]) => (action287 as unknown as (...args: unknown[]) => unknown)(...values),
"action.3328f976642407d3bb758851": (values: unknown[]) => (action288 as unknown as (...args: unknown[]) => unknown)(...values),
"action.e1c71ae1f667bfa62cac8bfa": (values: unknown[]) => (action289 as unknown as (...args: unknown[]) => unknown)(...values),
"action.0b43f27dcc5613ae950c92e0": (values: unknown[]) => (action290 as unknown as (...args: unknown[]) => unknown)(...values),
"action.9c003c514393eb0c40456d6d": (values: unknown[]) => (action291 as unknown as (...args: unknown[]) => unknown)(...values),
"action.3470ba5f84cd735396917ac1": (values: unknown[]) => (action292 as unknown as (...args: unknown[]) => unknown)(...values),
"action.dbbf589caa638c4b301f50dd": (values: unknown[]) => (action293 as unknown as (...args: unknown[]) => unknown)(...values),
"action.9226c3e659b438d3631fb5f4": (values: unknown[]) => (action294 as unknown as (...args: unknown[]) => unknown)(...values),
"action.65b74daa544272e68a6971b1": (values: unknown[]) => (action295 as unknown as (...args: unknown[]) => unknown)(...values),
"action.0af210864589a26446f777d6": (values: unknown[]) => (action296 as unknown as (...args: unknown[]) => unknown)(...values),
"action.c0312284ce4561de83547d1a": (values: unknown[]) => (action297 as unknown as (...args: unknown[]) => unknown)(...values),
"action.37163ef18027d9a42141b764": (values: unknown[]) => (action298 as unknown as (...args: unknown[]) => unknown)(...values),
"action.e0180c8c1867ee8bdc0e937f": (values: unknown[]) => (action299 as unknown as (...args: unknown[]) => unknown)(...values),
"action.e380ac00aecc3d65f25a1f54": (values: unknown[]) => (action300 as unknown as (...args: unknown[]) => unknown)(...values),
"action.5f59a9dc86edf620500faea2": (values: unknown[]) => (action301 as unknown as (...args: unknown[]) => unknown)(...values),
"action.8932ff3a79e278527019c086": (values: unknown[]) => (action302 as unknown as (...args: unknown[]) => unknown)(...values),
"action.e9dd5ea7780ddceb2d7e53ba": (values: unknown[]) => (action303 as unknown as (...args: unknown[]) => unknown)(...values),
"action.889b535531e80a4b8b649de8": (values: unknown[]) => (action304 as unknown as (...args: unknown[]) => unknown)(...values),
"action.6fd7b5830eab4d395e5fe2cd": (values: unknown[]) => (action305 as unknown as (...args: unknown[]) => unknown)(...values),
"action.cb40b4e47805aac83680fba2": (values: unknown[]) => (action306 as unknown as (...args: unknown[]) => unknown)(...values),
"action.1bfbdc4d83449f475b758906": (values: unknown[]) => (action307 as unknown as (...args: unknown[]) => unknown)(...values),
"action.12f5502676580d765e7cb609": (values: unknown[]) => (action308 as unknown as (...args: unknown[]) => unknown)(...values),
"action.424821f362cce37338ac2706": (values: unknown[]) => (action309 as unknown as (...args: unknown[]) => unknown)(...values),
"action.9fd4ab0baf110f64f1724bbc": (values: unknown[]) => (action310 as unknown as (...args: unknown[]) => unknown)(...values),
"action.b3c9e30ba50c20ac87db234e": (values: unknown[]) => (action311 as unknown as (...args: unknown[]) => unknown)(...values),
"action.0331240a42531083fcd3a4d7": (values: unknown[]) => (action312 as unknown as (...args: unknown[]) => unknown)(...values),
"action.0c401bb88ab58561433b2370": (values: unknown[]) => (action313 as unknown as (...args: unknown[]) => unknown)(...values),
"action.d14797e33bdffa7d9940f9f4": (values: unknown[]) => (action314 as unknown as (...args: unknown[]) => unknown)(...values),
"action.135d0e25e4ee7c14d97966da": (values: unknown[]) => (action315 as unknown as (...args: unknown[]) => unknown)(...values),
"action.71559420db869529e30eabcb": (values: unknown[]) => (action316 as unknown as (...args: unknown[]) => unknown)(...values),
"action.c6936e7df92440098868ffc8": (values: unknown[]) => (action317 as unknown as (...args: unknown[]) => unknown)(...values),
"action.59a914e15c81c5ff5299612a": (values: unknown[]) => (action318 as unknown as (...args: unknown[]) => unknown)(...values),
};
export async function runAppLocalCommand(name:string, values:unknown[]){const action=commands[name];if(!action)throw Object.assign(new Error("Unsupported form"),{status:404});return await action(values);}
