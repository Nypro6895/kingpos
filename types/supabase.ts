export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      account_favorite_customers: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_favorite_customers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_favorite_customers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      account_memberships: {
        Row: {
          account_id: string
          created_at: string
          id: string
          joined_at: string | null
          role_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          joined_at?: string | null
          role_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          joined_at?: string | null
          role_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_memberships_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_memberships_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          created_at: string
          id: string
          name: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      app_notifications: {
        Row: {
          account_id: string | null
          body: string | null
          booking_id: string | null
          created_at: string
          event_key: string | null
          href: string
          id: string
          notification_type: string
          read_at: string | null
          recipient_kind: string
          recipient_user_id: string
          salon_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          body?: string | null
          booking_id?: string | null
          created_at?: string
          event_key?: string | null
          href: string
          id?: string
          notification_type: string
          read_at?: string | null
          recipient_kind: string
          recipient_user_id: string
          salon_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          body?: string | null
          booking_id?: string | null
          created_at?: string
          event_key?: string | null
          href?: string
          id?: string
          notification_type?: string
          read_at?: string | null
          recipient_kind?: string
          recipient_user_id?: string
          salon_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_notifications_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_notifications_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_notifications_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_notifications_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_customer_account_claims: {
        Row: {
          booking_id: string
          claim_method: string
          claim_status: string
          created_at: string
          customer_user_id: string
          id: string
          metadata: Json
          proof_type: string
          salon_id: string
        }
        Insert: {
          booking_id: string
          claim_method: string
          claim_status?: string
          created_at?: string
          customer_user_id: string
          id?: string
          metadata?: Json
          proof_type: string
          salon_id: string
        }
        Update: {
          booking_id?: string
          claim_method?: string
          claim_status?: string
          created_at?: string
          customer_user_id?: string
          id?: string
          metadata?: Json
          proof_type?: string
          salon_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_customer_account_claims_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_customer_account_claims_customer_user_id_fkey"
            columns: ["customer_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_customer_account_claims_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_inspirations: {
        Row: {
          booking_id: string
          booking_line_id: string | null
          created_at: string
          credited_staff_id: string | null
          credited_staff_name_snapshot: string | null
          id: string
          metadata: Json
          salon_id: string
          salon_name_snapshot: string | null
          service_id: string | null
          service_name_snapshot: string | null
          source_booking_note_snapshot: string | null
          source_caption_snapshot: string | null
          source_content_id: string | null
          source_media_asset_id: string | null
          source_media_bucket: string
          source_media_height: number | null
          source_media_mime_type: string | null
          source_media_path: string | null
          source_media_width: number | null
          source_salon_id: string
          source_title_snapshot: string | null
          source_type: string
          updated_at: string
        }
        Insert: {
          booking_id: string
          booking_line_id?: string | null
          created_at?: string
          credited_staff_id?: string | null
          credited_staff_name_snapshot?: string | null
          id?: string
          metadata?: Json
          salon_id: string
          salon_name_snapshot?: string | null
          service_id?: string | null
          service_name_snapshot?: string | null
          source_booking_note_snapshot?: string | null
          source_caption_snapshot?: string | null
          source_content_id?: string | null
          source_media_asset_id?: string | null
          source_media_bucket?: string
          source_media_height?: number | null
          source_media_mime_type?: string | null
          source_media_path?: string | null
          source_media_width?: number | null
          source_salon_id: string
          source_title_snapshot?: string | null
          source_type?: string
          updated_at?: string
        }
        Update: {
          booking_id?: string
          booking_line_id?: string | null
          created_at?: string
          credited_staff_id?: string | null
          credited_staff_name_snapshot?: string | null
          id?: string
          metadata?: Json
          salon_id?: string
          salon_name_snapshot?: string | null
          service_id?: string | null
          service_name_snapshot?: string | null
          source_booking_note_snapshot?: string | null
          source_caption_snapshot?: string | null
          source_content_id?: string | null
          source_media_asset_id?: string | null
          source_media_bucket?: string
          source_media_height?: number | null
          source_media_mime_type?: string | null
          source_media_path?: string | null
          source_media_width?: number | null
          source_salon_id?: string
          source_title_snapshot?: string | null
          source_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_inspirations_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_inspirations_booking_line_id_fkey"
            columns: ["booking_line_id"]
            isOneToOne: false
            referencedRelation: "booking_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_inspirations_credited_staff_id_fkey"
            columns: ["credited_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_inspirations_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_inspirations_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_inspirations_source_media_asset_id_fkey"
            columns: ["source_media_asset_id"]
            isOneToOne: false
            referencedRelation: "salon_profile_media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_inspirations_source_salon_id_fkey"
            columns: ["source_salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_lines: {
        Row: {
          assigned_staff_id: string | null
          booking_id: string
          cleanup_buffer_minutes: number
          completed_at: string | null
          created_at: string
          display_order: number
          duration_minutes: number
          id: string
          internal_staff_note: string | null
          line_status: string
          line_status_updated_at: string | null
          line_status_updated_by_user_id: string | null
          line_total: number
          line_type: string
          overbooking_override_at: string | null
          overbooking_override_by_user_id: string | null
          overbooking_override_reason: string | null
          parent_booking_line_id: string | null
          performed_by_staff_id: string | null
          quantity: number
          salon_id: string
          scheduled_end_at: string | null
          scheduled_start_at: string | null
          service_category_snapshot: string | null
          service_description_snapshot: string | null
          service_id: string | null
          service_name_snapshot: string
          service_note: string | null
          started_at: string | null
          unit_price: number
          updated_at: string
        }
        Insert: {
          assigned_staff_id?: string | null
          booking_id: string
          cleanup_buffer_minutes?: number
          completed_at?: string | null
          created_at?: string
          display_order?: number
          duration_minutes?: number
          id?: string
          internal_staff_note?: string | null
          line_status?: string
          line_status_updated_at?: string | null
          line_status_updated_by_user_id?: string | null
          line_total?: number
          line_type?: string
          overbooking_override_at?: string | null
          overbooking_override_by_user_id?: string | null
          overbooking_override_reason?: string | null
          parent_booking_line_id?: string | null
          performed_by_staff_id?: string | null
          quantity?: number
          salon_id: string
          scheduled_end_at?: string | null
          scheduled_start_at?: string | null
          service_category_snapshot?: string | null
          service_description_snapshot?: string | null
          service_id?: string | null
          service_name_snapshot: string
          service_note?: string | null
          started_at?: string | null
          unit_price?: number
          updated_at?: string
        }
        Update: {
          assigned_staff_id?: string | null
          booking_id?: string
          cleanup_buffer_minutes?: number
          completed_at?: string | null
          created_at?: string
          display_order?: number
          duration_minutes?: number
          id?: string
          internal_staff_note?: string | null
          line_status?: string
          line_status_updated_at?: string | null
          line_status_updated_by_user_id?: string | null
          line_total?: number
          line_type?: string
          overbooking_override_at?: string | null
          overbooking_override_by_user_id?: string | null
          overbooking_override_reason?: string | null
          parent_booking_line_id?: string | null
          performed_by_staff_id?: string | null
          quantity?: number
          salon_id?: string
          scheduled_end_at?: string | null
          scheduled_start_at?: string | null
          service_category_snapshot?: string | null
          service_description_snapshot?: string | null
          service_id?: string | null
          service_name_snapshot?: string
          service_note?: string | null
          started_at?: string | null
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_lines_assigned_staff_id_fkey"
            columns: ["assigned_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_lines_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_lines_line_status_updated_by_user_id_fkey"
            columns: ["line_status_updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_lines_overbooking_override_by_user_id_fkey"
            columns: ["overbooking_override_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_lines_parent_booking_line_id_fkey"
            columns: ["parent_booking_line_id"]
            isOneToOne: false
            referencedRelation: "booking_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_lines_performed_by_staff_id_fkey"
            columns: ["performed_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_lines_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_lines_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_settings: {
        Row: {
          any_professional_enabled: boolean
          booking_enabled: boolean
          cancellation_window_minutes: number
          confirmation_mode: string
          created_at: string
          default_cleanup_buffer_minutes: number
          deposit_policy: Json
          deposit_required_enabled: boolean
          guest_booking_enabled: boolean
          id: string
          late_cancellation_policy: Json
          maximum_advance_window_days: number
          minimum_lead_time_minutes: number
          no_show_policy: Json
          online_booking_visible: boolean
          payment_required_enabled: boolean
          salon_id: string
          same_day_booking_enabled: boolean
          slot_interval_minutes: number
          split_staff_appointment_enabled: boolean
          ticket_creation_mode: string
          timezone_iana: string
          updated_at: string
        }
        Insert: {
          any_professional_enabled?: boolean
          booking_enabled?: boolean
          cancellation_window_minutes?: number
          confirmation_mode?: string
          created_at?: string
          default_cleanup_buffer_minutes?: number
          deposit_policy?: Json
          deposit_required_enabled?: boolean
          guest_booking_enabled?: boolean
          id?: string
          late_cancellation_policy?: Json
          maximum_advance_window_days?: number
          minimum_lead_time_minutes?: number
          no_show_policy?: Json
          online_booking_visible?: boolean
          payment_required_enabled?: boolean
          salon_id: string
          same_day_booking_enabled?: boolean
          slot_interval_minutes?: number
          split_staff_appointment_enabled?: boolean
          ticket_creation_mode?: string
          timezone_iana?: string
          updated_at?: string
        }
        Update: {
          any_professional_enabled?: boolean
          booking_enabled?: boolean
          cancellation_window_minutes?: number
          confirmation_mode?: string
          created_at?: string
          default_cleanup_buffer_minutes?: number
          deposit_policy?: Json
          deposit_required_enabled?: boolean
          guest_booking_enabled?: boolean
          id?: string
          late_cancellation_policy?: Json
          maximum_advance_window_days?: number
          minimum_lead_time_minutes?: number
          no_show_policy?: Json
          online_booking_visible?: boolean
          payment_required_enabled?: boolean
          salon_id?: string
          same_day_booking_enabled?: boolean
          slot_interval_minutes?: number
          split_staff_appointment_enabled?: boolean
          ticket_creation_mode?: string
          timezone_iana?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_settings_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: true
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_status_events: {
        Row: {
          actor_source: string
          actor_staff_id: string | null
          actor_user_id: string | null
          booking_id: string
          created_at: string
          event_type: string
          id: string
          metadata: Json
          new_status: string | null
          old_status: string | null
          salon_id: string
        }
        Insert: {
          actor_source?: string
          actor_staff_id?: string | null
          actor_user_id?: string | null
          booking_id: string
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          new_status?: string | null
          old_status?: string | null
          salon_id: string
        }
        Update: {
          actor_source?: string
          actor_staff_id?: string | null
          actor_user_id?: string | null
          booking_id?: string
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          new_status?: string | null
          old_status?: string | null
          salon_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_status_events_actor_staff_id_fkey"
            columns: ["actor_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_status_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_status_events_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_status_events_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          cancellation_policy_snapshot: Json
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by_user_id: string | null
          confirmation_mode: string
          confirmation_status: string
          created_at: string
          created_by_user_id: string | null
          customer_account_link_metadata: Json
          customer_account_link_method: string | null
          customer_account_linked_at: string | null
          customer_account_linked_by_user_id: string | null
          customer_cancellation_token_hash: string | null
          customer_id: string
          customer_user_id: string | null
          deposit_policy_snapshot: Json
          end_at: string
          id: string
          idempotency_key: string | null
          internal_notes: string | null
          no_show_at: string | null
          no_show_by_user_id: string | null
          no_show_reason: string | null
          notes: string | null
          payment_status: string
          pos_ticket_id: string | null
          public_notes: string | null
          salon_id: string
          salon_timezone_snapshot: string
          source: string
          source_reference_id: string | null
          source_reference_type: string | null
          staff_id: string | null
          start_at: string
          status: string
          updated_at: string
          updated_by_user_id: string | null
        }
        Insert: {
          cancellation_policy_snapshot?: Json
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by_user_id?: string | null
          confirmation_mode?: string
          confirmation_status?: string
          created_at?: string
          created_by_user_id?: string | null
          customer_account_link_metadata?: Json
          customer_account_link_method?: string | null
          customer_account_linked_at?: string | null
          customer_account_linked_by_user_id?: string | null
          customer_cancellation_token_hash?: string | null
          customer_id: string
          customer_user_id?: string | null
          deposit_policy_snapshot?: Json
          end_at: string
          id?: string
          idempotency_key?: string | null
          internal_notes?: string | null
          no_show_at?: string | null
          no_show_by_user_id?: string | null
          no_show_reason?: string | null
          notes?: string | null
          payment_status?: string
          pos_ticket_id?: string | null
          public_notes?: string | null
          salon_id: string
          salon_timezone_snapshot?: string
          source?: string
          source_reference_id?: string | null
          source_reference_type?: string | null
          staff_id?: string | null
          start_at: string
          status?: string
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Update: {
          cancellation_policy_snapshot?: Json
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by_user_id?: string | null
          confirmation_mode?: string
          confirmation_status?: string
          created_at?: string
          created_by_user_id?: string | null
          customer_account_link_metadata?: Json
          customer_account_link_method?: string | null
          customer_account_linked_at?: string | null
          customer_account_linked_by_user_id?: string | null
          customer_cancellation_token_hash?: string | null
          customer_id?: string
          customer_user_id?: string | null
          deposit_policy_snapshot?: Json
          end_at?: string
          id?: string
          idempotency_key?: string | null
          internal_notes?: string | null
          no_show_at?: string | null
          no_show_by_user_id?: string | null
          no_show_reason?: string | null
          notes?: string | null
          payment_status?: string
          pos_ticket_id?: string | null
          public_notes?: string | null
          salon_id?: string
          salon_timezone_snapshot?: string
          source?: string
          source_reference_id?: string | null
          source_reference_type?: string | null
          staff_id?: string | null
          start_at?: string
          status?: string
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_cancelled_by_user_id_fkey"
            columns: ["cancelled_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_customer_account_linked_by_user_id_fkey"
            columns: ["customer_account_linked_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_customer_user_id_fkey"
            columns: ["customer_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_no_show_by_user_id_fkey"
            columns: ["no_show_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_pos_ticket_id_fkey"
            columns: ["pos_ticket_id"]
            isOneToOne: false
            referencedRelation: "pos_tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string
          created_by_user_id: string | null
          customer_user_id: string | null
          email: string | null
          id: string
          internal_notes: string | null
          location_id: string
          name: string
          notes: string | null
          phone: string | null
          source: string
          staff_notes: string | null
          status: string
          updated_at: string
          updated_by_user_id: string | null
        }
        Insert: {
          created_at?: string
          created_by_user_id?: string | null
          customer_user_id?: string | null
          email?: string | null
          id?: string
          internal_notes?: string | null
          location_id: string
          name: string
          notes?: string | null
          phone?: string | null
          source?: string
          staff_notes?: string | null
          status?: string
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Update: {
          created_at?: string
          created_by_user_id?: string | null
          customer_user_id?: string | null
          email?: string | null
          id?: string
          internal_notes?: string | null
          location_id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          source?: string
          staff_notes?: string | null
          status?: string
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_customer_user_id_fkey"
            columns: ["customer_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          account_id: string
          address_line1: string | null
          address_line2: string | null
          city: string | null
          country: string
          create_request_key: string | null
          created_at: string
          geocoded_at: string | null
          geocoding_address_fingerprint: string | null
          geocoding_error_code: string | null
          geocoding_place_id: string | null
          geocoding_provider: string | null
          geocoding_status: string | null
          id: string
          latitude: number | null
          longitude: number | null
          name: string
          phone: string | null
          postal_code: string | null
          state: string | null
          status: string
          updated_at: string
        }
        Insert: {
          account_id: string
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          country?: string
          create_request_key?: string | null
          created_at?: string
          geocoded_at?: string | null
          geocoding_address_fingerprint?: string | null
          geocoding_error_code?: string | null
          geocoding_place_id?: string | null
          geocoding_provider?: string | null
          geocoding_status?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name: string
          phone?: string | null
          postal_code?: string | null
          state?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          country?: string
          create_request_key?: string | null
          created_at?: string
          geocoded_at?: string | null
          geocoding_address_fingerprint?: string | null
          geocoding_error_code?: string | null
          geocoding_place_id?: string | null
          geocoding_provider?: string | null
          geocoding_status?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          phone?: string | null
          postal_code?: string | null
          state?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_paystubs: {
        Row: {
          created_at: string
          file_name: string | null
          file_url_or_path: string | null
          id: string
          mime_type: string | null
          note: string | null
          payroll_run_id: string
          salon_id: string
          size_bytes: number | null
          staff_id: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          file_name?: string | null
          file_url_or_path?: string | null
          id?: string
          mime_type?: string | null
          note?: string | null
          payroll_run_id: string
          salon_id: string
          size_bytes?: number | null
          staff_id: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string | null
          file_url_or_path?: string | null
          id?: string
          mime_type?: string | null
          note?: string | null
          payroll_run_id?: string
          salon_id?: string
          size_bytes?: number | null
          staff_id?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_paystubs_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_paystubs_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_paystubs_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_paystubs_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_period_staff_input_history: {
        Row: {
          change_type: string
          created_at: string
          created_by: string | null
          cycle_type: string
          field_changes: Json
          id: string
          new_value_json: Json
          payroll_run_id: string | null
          period_end: string
          period_staff_input_id: string | null
          period_start: string
          previous_value_json: Json
          salon_id: string
          staff_id: string
        }
        Insert: {
          change_type: string
          created_at?: string
          created_by?: string | null
          cycle_type: string
          field_changes?: Json
          id?: string
          new_value_json?: Json
          payroll_run_id?: string | null
          period_end: string
          period_staff_input_id?: string | null
          period_start: string
          previous_value_json?: Json
          salon_id: string
          staff_id: string
        }
        Update: {
          change_type?: string
          created_at?: string
          created_by?: string | null
          cycle_type?: string
          field_changes?: Json
          id?: string
          new_value_json?: Json
          payroll_run_id?: string | null
          period_end?: string
          period_staff_input_id?: string | null
          period_start?: string
          previous_value_json?: Json
          salon_id?: string
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_period_staff_input_history_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_period_staff_input_history_period_staff_input_id_fkey"
            columns: ["period_staff_input_id"]
            isOneToOne: false
            referencedRelation: "payroll_period_staff_inputs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_period_staff_input_history_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_period_staff_input_history_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_period_staff_input_history_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_period_staff_inputs: {
        Row: {
          bonus_amount: number
          check_number: string | null
          created_at: string
          cycle_type: string
          id: string
          note: string | null
          period_end: string
          period_start: string
          salon_id: string
          staff_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          bonus_amount?: number
          check_number?: string | null
          created_at?: string
          cycle_type: string
          id?: string
          note?: string | null
          period_end: string
          period_start: string
          salon_id: string
          staff_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          bonus_amount?: number
          check_number?: string | null
          created_at?: string
          cycle_type?: string
          id?: string
          note?: string | null
          period_end?: string
          period_start?: string
          salon_id?: string
          staff_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_period_staff_inputs_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_period_staff_inputs_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_period_staff_inputs_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_runs: {
        Row: {
          correction_snapshot: Json
          created_at: string
          cycle_type: string
          generated_at: string
          id: string
          locked_at: string | null
          locked_by: string | null
          paid_at: string | null
          paid_by: string | null
          period_end: string
          period_start: string
          printed_at: string | null
          printed_by: string | null
          salon_id: string
          settings_snapshot: Json
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          correction_snapshot?: Json
          created_at?: string
          cycle_type: string
          generated_at?: string
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          paid_at?: string | null
          paid_by?: string | null
          period_end: string
          period_start: string
          printed_at?: string | null
          printed_by?: string | null
          salon_id: string
          settings_snapshot?: Json
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          correction_snapshot?: Json
          created_at?: string
          cycle_type?: string
          generated_at?: string
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          paid_at?: string | null
          paid_by?: string | null
          period_end?: string
          period_start?: string
          printed_at?: string | null
          printed_by?: string | null
          salon_id?: string
          settings_snapshot?: Json
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_runs_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_printed_by_fkey"
            columns: ["printed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_staff_daily_totals: {
        Row: {
          business_date: string
          check_rate_used: number | null
          commission_rate_used: number | null
          correction_delta: number
          created_at: string
          fixed_pay_amount_used: number | null
          gross_sales: number
          id: string
          note: string | null
          pay_type_used: string | null
          payroll_run_id: string | null
          salon_id: string
          settings_used_snapshot: Json
          staff_id: string
          tax_rate_used: number | null
          tip_amount: number
          updated_at: string
        }
        Insert: {
          business_date: string
          check_rate_used?: number | null
          commission_rate_used?: number | null
          correction_delta?: number
          created_at?: string
          fixed_pay_amount_used?: number | null
          gross_sales?: number
          id?: string
          note?: string | null
          pay_type_used?: string | null
          payroll_run_id?: string | null
          salon_id: string
          settings_used_snapshot?: Json
          staff_id: string
          tax_rate_used?: number | null
          tip_amount?: number
          updated_at?: string
        }
        Update: {
          business_date?: string
          check_rate_used?: number | null
          commission_rate_used?: number | null
          correction_delta?: number
          created_at?: string
          fixed_pay_amount_used?: number | null
          gross_sales?: number
          id?: string
          note?: string | null
          pay_type_used?: string | null
          payroll_run_id?: string | null
          salon_id?: string
          settings_used_snapshot?: Json
          staff_id?: string
          tax_rate_used?: number | null
          tip_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_staff_daily_totals_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_staff_daily_totals_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_staff_daily_totals_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_staff_lines: {
        Row: {
          base_cash_amount: number
          base_check_amount: number
          bonus_amount: number
          bonus_cash_amount: number
          bonus_check_amount: number
          bonus_payout_method_snapshot: string
          cash_amount: number
          cash_to_tax_company_snapshot: boolean
          check_gross: number
          check_net: number
          check_number: string | null
          check_rate_used: number
          commission_rate_used: number
          created_at: string
          earned_amount: number
          final_cash_amount: number
          final_check_amount: number
          final_staff_income: number
          fixed_pay_amount_used: number
          gross_sales: number
          id: string
          is_mixed_rate: boolean
          note: string | null
          pay_type_used: string
          payroll_run_id: string
          period_staff_input_snapshot: Json
          salon_id: string
          settings_used_snapshot: Json
          shop_share: number
          staff_commission_gross: number
          staff_display_name_snapshot: string
          staff_id: string
          staff_legal_name_snapshot: string | null
          tax_bonus_snapshot: boolean
          tax_company_cash_amount: number
          tax_company_check_amount: number
          tax_company_enabled_snapshot: boolean
          tax_company_reported_wage_gross: number
          tax_company_taxable_gross: number
          tax_rate_used: number
          tax_tips_snapshot: boolean
          tax_withheld: number
          tip_allocation_method: string
          tip_amount: number
          tip_cash_amount: number
          tip_check_amount: number
          tip_payout_method_snapshot: string
          updated_at: string
        }
        Insert: {
          base_cash_amount?: number
          base_check_amount?: number
          bonus_amount?: number
          bonus_cash_amount?: number
          bonus_check_amount?: number
          bonus_payout_method_snapshot?: string
          cash_amount?: number
          cash_to_tax_company_snapshot?: boolean
          check_gross?: number
          check_net?: number
          check_number?: string | null
          check_rate_used?: number
          commission_rate_used?: number
          created_at?: string
          earned_amount?: number
          final_cash_amount?: number
          final_check_amount?: number
          final_staff_income?: number
          fixed_pay_amount_used?: number
          gross_sales?: number
          id?: string
          is_mixed_rate?: boolean
          note?: string | null
          pay_type_used?: string
          payroll_run_id: string
          period_staff_input_snapshot?: Json
          salon_id: string
          settings_used_snapshot?: Json
          shop_share?: number
          staff_commission_gross?: number
          staff_display_name_snapshot: string
          staff_id: string
          staff_legal_name_snapshot?: string | null
          tax_bonus_snapshot?: boolean
          tax_company_cash_amount?: number
          tax_company_check_amount?: number
          tax_company_enabled_snapshot?: boolean
          tax_company_reported_wage_gross?: number
          tax_company_taxable_gross?: number
          tax_rate_used?: number
          tax_tips_snapshot?: boolean
          tax_withheld?: number
          tip_allocation_method?: string
          tip_amount?: number
          tip_cash_amount?: number
          tip_check_amount?: number
          tip_payout_method_snapshot?: string
          updated_at?: string
        }
        Update: {
          base_cash_amount?: number
          base_check_amount?: number
          bonus_amount?: number
          bonus_cash_amount?: number
          bonus_check_amount?: number
          bonus_payout_method_snapshot?: string
          cash_amount?: number
          cash_to_tax_company_snapshot?: boolean
          check_gross?: number
          check_net?: number
          check_number?: string | null
          check_rate_used?: number
          commission_rate_used?: number
          created_at?: string
          earned_amount?: number
          final_cash_amount?: number
          final_check_amount?: number
          final_staff_income?: number
          fixed_pay_amount_used?: number
          gross_sales?: number
          id?: string
          is_mixed_rate?: boolean
          note?: string | null
          pay_type_used?: string
          payroll_run_id?: string
          period_staff_input_snapshot?: Json
          salon_id?: string
          settings_used_snapshot?: Json
          shop_share?: number
          staff_commission_gross?: number
          staff_display_name_snapshot?: string
          staff_id?: string
          staff_legal_name_snapshot?: string | null
          tax_bonus_snapshot?: boolean
          tax_company_cash_amount?: number
          tax_company_check_amount?: number
          tax_company_enabled_snapshot?: boolean
          tax_company_reported_wage_gross?: number
          tax_company_taxable_gross?: number
          tax_rate_used?: number
          tax_tips_snapshot?: boolean
          tax_withheld?: number
          tip_allocation_method?: string
          tip_amount?: number
          tip_cash_amount?: number
          tip_check_amount?: number
          tip_payout_method_snapshot?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_staff_lines_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_staff_lines_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_staff_lines_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          category: string
          code: string
          created_at: string
          description: string | null
          id: string
          is_system: boolean
          name: string
          updated_at: string
        }
        Insert: {
          category: string
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          category?: string
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      pos_daily_closing_staff_snapshots: {
        Row: {
          big_turn_count_snapshot: number
          closing_id: string
          created_at: string
          id: string
          report_date: string
          salon_id: string
          small_turn_count_snapshot: number
          staff_id: string | null
          staff_name_snapshot: string
          tip_snapshot: number
          total_earned_snapshot: number
          total_turns_snapshot: number
        }
        Insert: {
          big_turn_count_snapshot?: number
          closing_id: string
          created_at?: string
          id?: string
          report_date: string
          salon_id: string
          small_turn_count_snapshot?: number
          staff_id?: string | null
          staff_name_snapshot: string
          tip_snapshot?: number
          total_earned_snapshot?: number
          total_turns_snapshot?: number
        }
        Update: {
          big_turn_count_snapshot?: number
          closing_id?: string
          created_at?: string
          id?: string
          report_date?: string
          salon_id?: string
          small_turn_count_snapshot?: number
          staff_id?: string | null
          staff_name_snapshot?: string
          tip_snapshot?: number
          total_earned_snapshot?: number
          total_turns_snapshot?: number
        }
        Relationships: [
          {
            foreignKeyName: "pos_daily_closing_staff_snapshots_closing_id_fkey"
            columns: ["closing_id"]
            isOneToOne: false
            referencedRelation: "pos_daily_closings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_daily_closing_staff_snapshots_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_daily_closing_staff_snapshots_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_daily_closings: {
        Row: {
          actual_total_snapshot: number | null
          approved_at: string | null
          approved_by: string | null
          cash_amount: number
          cash_amount_snapshot: number | null
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string | null
          credit_card_amount: number
          credit_card_amount_snapshot: number | null
          difference_snapshot: number | null
          discount_snapshot: number | null
          expected_total_snapshot: number | null
          finalized_ticket_count_snapshot: number | null
          gift_card_snapshot: number | null
          id: string
          lock_reason: string | null
          lock_type: string | null
          locked_at: string | null
          locked_by: string | null
          note: string | null
          note_snapshot: string | null
          other_amount: number
          other_amount_snapshot: number | null
          report_date: string
          salon_id: string
          snapshot_created_at: string | null
          staff_earned_snapshot: number | null
          status: string
          ticket_count_snapshot: number | null
          tip_snapshot: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          actual_total_snapshot?: number | null
          approved_at?: string | null
          approved_by?: string | null
          cash_amount?: number
          cash_amount_snapshot?: number | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          credit_card_amount?: number
          credit_card_amount_snapshot?: number | null
          difference_snapshot?: number | null
          discount_snapshot?: number | null
          expected_total_snapshot?: number | null
          finalized_ticket_count_snapshot?: number | null
          gift_card_snapshot?: number | null
          id?: string
          lock_reason?: string | null
          lock_type?: string | null
          locked_at?: string | null
          locked_by?: string | null
          note?: string | null
          note_snapshot?: string | null
          other_amount?: number
          other_amount_snapshot?: number | null
          report_date: string
          salon_id: string
          snapshot_created_at?: string | null
          staff_earned_snapshot?: number | null
          status?: string
          ticket_count_snapshot?: number | null
          tip_snapshot?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          actual_total_snapshot?: number | null
          approved_at?: string | null
          approved_by?: string | null
          cash_amount?: number
          cash_amount_snapshot?: number | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          credit_card_amount?: number
          credit_card_amount_snapshot?: number | null
          difference_snapshot?: number | null
          discount_snapshot?: number | null
          expected_total_snapshot?: number | null
          finalized_ticket_count_snapshot?: number | null
          gift_card_snapshot?: number | null
          id?: string
          lock_reason?: string | null
          lock_type?: string | null
          locked_at?: string | null
          locked_by?: string | null
          note?: string | null
          note_snapshot?: string | null
          other_amount?: number
          other_amount_snapshot?: number | null
          report_date?: string
          salon_id?: string
          snapshot_created_at?: string | null
          staff_earned_snapshot?: number | null
          status?: string
          ticket_count_snapshot?: number | null
          tip_snapshot?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_daily_closings_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_daily_closings_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_daily_closings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_daily_closings_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_daily_closings_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_daily_closings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_desk_session_lines: {
        Row: {
          amount: number
          amount_input: string
          amount_parts: Json
          created_at: string
          id: string
          salon_id: string
          service_id: string | null
          service_label: string
          session_id: string
          sort_order: number
          staff_id: string
          turn_large_count: number
          turn_small_count: number
          updated_at: string
        }
        Insert: {
          amount: number
          amount_input: string
          amount_parts?: Json
          created_at?: string
          id?: string
          salon_id: string
          service_id?: string | null
          service_label: string
          session_id: string
          sort_order?: number
          staff_id: string
          turn_large_count?: number
          turn_small_count?: number
          updated_at?: string
        }
        Update: {
          amount?: number
          amount_input?: string
          amount_parts?: Json
          created_at?: string
          id?: string
          salon_id?: string
          service_id?: string | null
          service_label?: string
          session_id?: string
          sort_order?: number
          staff_id?: string
          turn_large_count?: number
          turn_small_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_desk_session_lines_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_desk_session_lines_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_desk_session_lines_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "pos_desk_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_desk_session_lines_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_desk_sessions: {
        Row: {
          created_at: string
          created_by: string | null
          customer_confirmed_at: string | null
          customer_display_token: string
          customer_id: string | null
          customer_lookup_value: string | null
          customer_name_snapshot: string | null
          expires_at: string
          id: string
          last_activity_at: string
          note: string | null
          salon_id: string
          status: string
          submitted_ticket_id: string | null
          tip_amount: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_confirmed_at?: string | null
          customer_display_token: string
          customer_id?: string | null
          customer_lookup_value?: string | null
          customer_name_snapshot?: string | null
          expires_at?: string
          id?: string
          last_activity_at?: string
          note?: string | null
          salon_id: string
          status?: string
          submitted_ticket_id?: string | null
          tip_amount?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_confirmed_at?: string | null
          customer_display_token?: string
          customer_id?: string | null
          customer_lookup_value?: string | null
          customer_name_snapshot?: string | null
          expires_at?: string
          id?: string
          last_activity_at?: string
          note?: string | null
          salon_id?: string
          status?: string
          submitted_ticket_id?: string | null
          tip_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_desk_sessions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_desk_sessions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_desk_sessions_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_desk_sessions_submitted_ticket_id_fkey"
            columns: ["submitted_ticket_id"]
            isOneToOne: false
            referencedRelation: "pos_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_display_channels: {
        Row: {
          created_at: string
          customer_message: Json | null
          customer_message_version: number
          id: string
          pos_message: Json | null
          pos_message_version: number
          salon_id: string
          status: string
          token: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_message?: Json | null
          customer_message_version?: number
          id?: string
          pos_message?: Json | null
          pos_message_version?: number
          salon_id: string
          status?: string
          token: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_message?: Json | null
          customer_message_version?: number
          id?: string
          pos_message?: Json | null
          pos_message_version?: number
          salon_id?: string
          status?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_display_channels_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_financial_adjustments: {
        Row: {
          actual_total_delta: number
          business_date: string
          cash_delta: number
          correction_request_id: string | null
          created_at: string
          created_by: string | null
          credit_card_delta: number
          discount_delta: number
          expected_total_delta: number
          gift_card_delta: number
          id: string
          note: string | null
          other_delta: number
          salon_id: string
          service_delta: number
          staff_id: string | null
          target_id: string | null
          target_type: string
          ticket_id: string | null
          tip_delta: number
          turn_delta: number
        }
        Insert: {
          actual_total_delta?: number
          business_date: string
          cash_delta?: number
          correction_request_id?: string | null
          created_at?: string
          created_by?: string | null
          credit_card_delta?: number
          discount_delta?: number
          expected_total_delta?: number
          gift_card_delta?: number
          id?: string
          note?: string | null
          other_delta?: number
          salon_id: string
          service_delta?: number
          staff_id?: string | null
          target_id?: string | null
          target_type: string
          ticket_id?: string | null
          tip_delta?: number
          turn_delta?: number
        }
        Update: {
          actual_total_delta?: number
          business_date?: string
          cash_delta?: number
          correction_request_id?: string | null
          created_at?: string
          created_by?: string | null
          credit_card_delta?: number
          discount_delta?: number
          expected_total_delta?: number
          gift_card_delta?: number
          id?: string
          note?: string | null
          other_delta?: number
          salon_id?: string
          service_delta?: number
          staff_id?: string | null
          target_id?: string | null
          target_type?: string
          ticket_id?: string | null
          tip_delta?: number
          turn_delta?: number
        }
        Relationships: [
          {
            foreignKeyName: "pos_financial_adjustments_correction_request_id_fkey"
            columns: ["correction_request_id"]
            isOneToOne: false
            referencedRelation: "pos_financial_correction_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_financial_adjustments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_financial_adjustments_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_financial_adjustments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_financial_adjustments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "pos_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_financial_correction_requests: {
        Row: {
          admin_note: string | null
          applied_at: string | null
          approved_at: string | null
          approved_by: string | null
          business_date: string
          correction_type: string
          created_at: string
          id: string
          money_delta: number
          old_value_json: Json
          reason: string
          rejected_at: string | null
          rejected_by: string | null
          requested_at: string
          requested_by: string | null
          requested_value_json: Json
          salon_id: string
          status: string
          target_id: string | null
          target_type: string
          ticket_id: string | null
          updated_at: string
        }
        Insert: {
          admin_note?: string | null
          applied_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          business_date: string
          correction_type: string
          created_at?: string
          id?: string
          money_delta?: number
          old_value_json?: Json
          reason: string
          rejected_at?: string | null
          rejected_by?: string | null
          requested_at?: string
          requested_by?: string | null
          requested_value_json?: Json
          salon_id: string
          status?: string
          target_id?: string | null
          target_type: string
          ticket_id?: string | null
          updated_at?: string
        }
        Update: {
          admin_note?: string | null
          applied_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          business_date?: string
          correction_type?: string
          created_at?: string
          id?: string
          money_delta?: number
          old_value_json?: Json
          reason?: string
          rejected_at?: string | null
          rejected_by?: string | null
          requested_at?: string
          requested_by?: string | null
          requested_value_json?: Json
          salon_id?: string
          status?: string
          target_id?: string | null
          target_type?: string
          ticket_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_financial_correction_requests_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_financial_correction_requests_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_financial_correction_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_financial_correction_requests_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_financial_correction_requests_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "pos_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_live_drafts: {
        Row: {
          completed_at: string | null
          created_at: string
          customer: Json | null
          customer_version: number
          discount: number
          id: string
          last_customer_action_id: string | null
          last_tip_action_id: string | null
          receipt: Json
          receipt_version: number
          reset_at: string | null
          salon_id: string
          selected_staff_id: string | null
          staff_lines: Json
          status: string
          subtotal: number
          tax: number
          tip: number
          token: string
          total: number
          total_before_tip: number
          updated_at: string
          version: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          customer?: Json | null
          customer_version?: number
          discount?: number
          id?: string
          last_customer_action_id?: string | null
          last_tip_action_id?: string | null
          receipt?: Json
          receipt_version?: number
          reset_at?: string | null
          salon_id: string
          selected_staff_id?: string | null
          staff_lines?: Json
          status?: string
          subtotal?: number
          tax?: number
          tip?: number
          token: string
          total?: number
          total_before_tip?: number
          updated_at?: string
          version?: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          customer?: Json | null
          customer_version?: number
          discount?: number
          id?: string
          last_customer_action_id?: string | null
          last_tip_action_id?: string | null
          receipt?: Json
          receipt_version?: number
          reset_at?: string | null
          salon_id?: string
          selected_staff_id?: string | null
          staff_lines?: Json
          status?: string
          subtotal?: number
          tax?: number
          tip?: number
          token?: string
          total?: number
          total_before_tip?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "pos_live_drafts_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          payment_method: string
          salon_id: string
          ticket_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          payment_method: string
          salon_id: string
          ticket_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          payment_method?: string
          salon_id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_payments_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_payments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "pos_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_portable_access_keys: {
        Row: {
          access_id: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          label: string | null
          last_login_at: string | null
          last_logout_at: string | null
          last_used_at: string | null
          last_user_agent: string | null
          passcode_digest: string
          passcode_salt: string
          salon_id: string
          updated_at: string
        }
        Insert: {
          access_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          label?: string | null
          last_login_at?: string | null
          last_logout_at?: string | null
          last_used_at?: string | null
          last_user_agent?: string | null
          passcode_digest: string
          passcode_salt: string
          salon_id: string
          updated_at?: string
        }
        Update: {
          access_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          label?: string | null
          last_login_at?: string | null
          last_logout_at?: string | null
          last_used_at?: string | null
          last_user_agent?: string | null
          passcode_digest?: string
          passcode_salt?: string
          salon_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_portable_access_keys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_portable_access_keys_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_settings: {
        Row: {
          app_download_url: string
          created_at: string
          customer_background_image_path: string | null
          customer_left_ad_image_path: string | null
          customer_left_ad_text: string
          customer_promo_body: string
          customer_promo_title: string
          customer_right_ad_image_path: string | null
          customer_right_ad_text: string
          customer_show_barcode: boolean
          customer_show_customer_name: boolean
          customer_show_receipt_status: boolean
          customer_show_salon_name: boolean
          customer_show_service_name: boolean
          customer_show_staff_name: boolean
          large_turn_threshold: number
          salon_id: string
          staff_check_in_enabled: boolean
          tip_suggestions: number[]
          updated_at: string
        }
        Insert: {
          app_download_url?: string
          created_at?: string
          customer_background_image_path?: string | null
          customer_left_ad_image_path?: string | null
          customer_left_ad_text?: string
          customer_promo_body?: string
          customer_promo_title?: string
          customer_right_ad_image_path?: string | null
          customer_right_ad_text?: string
          customer_show_barcode?: boolean
          customer_show_customer_name?: boolean
          customer_show_receipt_status?: boolean
          customer_show_salon_name?: boolean
          customer_show_service_name?: boolean
          customer_show_staff_name?: boolean
          large_turn_threshold?: number
          salon_id: string
          staff_check_in_enabled?: boolean
          tip_suggestions?: number[]
          updated_at?: string
        }
        Update: {
          app_download_url?: string
          created_at?: string
          customer_background_image_path?: string | null
          customer_left_ad_image_path?: string | null
          customer_left_ad_text?: string
          customer_promo_body?: string
          customer_promo_title?: string
          customer_right_ad_image_path?: string | null
          customer_right_ad_text?: string
          customer_show_barcode?: boolean
          customer_show_customer_name?: boolean
          customer_show_receipt_status?: boolean
          customer_show_salon_name?: boolean
          customer_show_service_name?: boolean
          customer_show_staff_name?: boolean
          large_turn_threshold?: number
          salon_id?: string
          staff_check_in_enabled?: boolean
          tip_suggestions?: number[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_settings_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: true
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_ticket_adjustments: {
        Row: {
          action: string
          after_snapshot: Json
          before_snapshot: Json
          created_at: string
          created_by: string | null
          id: string
          reason: string
          replacement_ticket_item_id: string | null
          salon_id: string
          ticket_id: string
        }
        Insert: {
          action: string
          after_snapshot?: Json
          before_snapshot?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          reason: string
          replacement_ticket_item_id?: string | null
          salon_id: string
          ticket_id: string
        }
        Update: {
          action?: string
          after_snapshot?: Json
          before_snapshot?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          reason?: string
          replacement_ticket_item_id?: string | null
          salon_id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_ticket_adjustments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_ticket_adjustments_replacement_ticket_item_id_fkey"
            columns: ["replacement_ticket_item_id"]
            isOneToOne: false
            referencedRelation: "pos_ticket_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_ticket_adjustments_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_ticket_adjustments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "pos_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_ticket_audit_logs: {
        Row: {
          action: string
          created_at: string
          created_by: string | null
          id: string
          note: string
          salon_id: string
          ticket_id: string
        }
        Insert: {
          action: string
          created_at?: string
          created_by?: string | null
          id?: string
          note: string
          salon_id: string
          ticket_id: string
        }
        Update: {
          action?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string
          salon_id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_ticket_audit_logs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_ticket_audit_logs_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_ticket_audit_logs_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "pos_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_ticket_item_turn_parts: {
        Row: {
          amount: number
          created_at: string
          id: string
          salon_id: string
          staff_id: string
          ticket_id: string
          ticket_item_id: string
          turn_index: number
          turn_type: string
          work_date: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          salon_id: string
          staff_id: string
          ticket_id: string
          ticket_item_id: string
          turn_index: number
          turn_type: string
          work_date: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          salon_id?: string
          staff_id?: string
          ticket_id?: string
          ticket_item_id?: string
          turn_index?: number
          turn_type?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_ticket_item_turn_parts_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_ticket_item_turn_parts_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_ticket_item_turn_parts_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "pos_tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_ticket_item_turn_parts_ticket_item_id_fkey"
            columns: ["ticket_item_id"]
            isOneToOne: false
            referencedRelation: "pos_ticket_items"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_ticket_items: {
        Row: {
          assigned_staff_id: string | null
          booked_unit_price_snapshot: number | null
          created_at: string
          id: string
          is_removed: boolean
          line_total: number
          notes: string | null
          performed_by_staff_id: string | null
          pos_ticket_id: string
          quantity: number
          removal_reason: string | null
          removed_at: string | null
          removed_by: string | null
          salon_id: string
          service_category_snapshot: string | null
          service_id: string | null
          service_name_snapshot: string | null
          source_booking_id: string | null
          source_booking_line_id: string | null
          source_kind: string
          unit_price: number
          updated_at: string
        }
        Insert: {
          assigned_staff_id?: string | null
          booked_unit_price_snapshot?: number | null
          created_at?: string
          id?: string
          is_removed?: boolean
          line_total?: number
          notes?: string | null
          performed_by_staff_id?: string | null
          pos_ticket_id: string
          quantity?: number
          removal_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          salon_id: string
          service_category_snapshot?: string | null
          service_id?: string | null
          service_name_snapshot?: string | null
          source_booking_id?: string | null
          source_booking_line_id?: string | null
          source_kind?: string
          unit_price?: number
          updated_at?: string
        }
        Update: {
          assigned_staff_id?: string | null
          booked_unit_price_snapshot?: number | null
          created_at?: string
          id?: string
          is_removed?: boolean
          line_total?: number
          notes?: string | null
          performed_by_staff_id?: string | null
          pos_ticket_id?: string
          quantity?: number
          removal_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          salon_id?: string
          service_category_snapshot?: string | null
          service_id?: string | null
          service_name_snapshot?: string | null
          source_booking_id?: string | null
          source_booking_line_id?: string | null
          source_kind?: string
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_ticket_items_assigned_staff_id_fkey"
            columns: ["assigned_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_ticket_items_performed_by_staff_id_fkey"
            columns: ["performed_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_ticket_items_pos_ticket_id_fkey"
            columns: ["pos_ticket_id"]
            isOneToOne: false
            referencedRelation: "pos_tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_ticket_items_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_ticket_items_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_ticket_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_ticket_items_source_booking_id_fkey"
            columns: ["source_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_ticket_items_source_booking_line_id_fkey"
            columns: ["source_booking_line_id"]
            isOneToOne: false
            referencedRelation: "booking_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_ticket_staff_earnings: {
        Row: {
          big_turn_count: number
          bonus_amount: number
          calculation_version: number
          commission_amount: number
          created_at: string
          deduction_amount: number
          first_big_turn_sequence: number | null
          first_small_turn_sequence: number | null
          id: string
          last_big_turn_sequence: number | null
          last_small_turn_sequence: number | null
          locked_at: string | null
          manual_tip_amount: number | null
          payroll_batch_id: string | null
          salon_id: string
          service_total: number
          small_turn_count: number
          staff_id: string
          ticket_id: string
          tip_amount: number
          tip_is_manual: boolean
          total_earning: number
          updated_at: string
          work_date: string
        }
        Insert: {
          big_turn_count?: number
          bonus_amount?: number
          calculation_version?: number
          commission_amount?: number
          created_at?: string
          deduction_amount?: number
          first_big_turn_sequence?: number | null
          first_small_turn_sequence?: number | null
          id?: string
          last_big_turn_sequence?: number | null
          last_small_turn_sequence?: number | null
          locked_at?: string | null
          manual_tip_amount?: number | null
          payroll_batch_id?: string | null
          salon_id: string
          service_total?: number
          small_turn_count?: number
          staff_id: string
          ticket_id: string
          tip_amount?: number
          tip_is_manual?: boolean
          total_earning?: number
          updated_at?: string
          work_date: string
        }
        Update: {
          big_turn_count?: number
          bonus_amount?: number
          calculation_version?: number
          commission_amount?: number
          created_at?: string
          deduction_amount?: number
          first_big_turn_sequence?: number | null
          first_small_turn_sequence?: number | null
          id?: string
          last_big_turn_sequence?: number | null
          last_small_turn_sequence?: number | null
          locked_at?: string | null
          manual_tip_amount?: number | null
          payroll_batch_id?: string | null
          salon_id?: string
          service_total?: number
          small_turn_count?: number
          staff_id?: string
          ticket_id?: string
          tip_amount?: number
          tip_is_manual?: boolean
          total_earning?: number
          updated_at?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_ticket_staff_earnings_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_ticket_staff_earnings_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_ticket_staff_earnings_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "pos_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_tickets: {
        Row: {
          closed_at: string | null
          created_at: string
          customer_id: string | null
          discount_type: string
          discount_value: number
          id: string
          notes: string | null
          opened_at: string
          salon_id: string
          source_booking_id: string | null
          status: string
          tax_rate: number
          ticket_number: string
          ticket_sequence: number
          tip_type: string
          tip_value: number
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          customer_id?: string | null
          discount_type?: string
          discount_value?: number
          id?: string
          notes?: string | null
          opened_at?: string
          salon_id: string
          source_booking_id?: string | null
          status?: string
          tax_rate?: number
          ticket_number?: string
          ticket_sequence?: number
          tip_type?: string
          tip_value?: number
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          customer_id?: string | null
          discount_type?: string
          discount_value?: number
          id?: string
          notes?: string | null
          opened_at?: string
          salon_id?: string
          source_booking_id?: string | null
          status?: string
          tax_rate?: number
          ticket_number?: string
          ticket_sequence?: number
          tip_type?: string
          tip_value?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_tickets_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_tickets_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_tickets_source_booking_id_fkey"
            columns: ["source_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          created_at: string
          id: string
          permission_id: string
          role_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          permission_id: string
          role_id: string
        }
        Update: {
          created_at?: string
          id?: string
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          account_id: string
          code: string
          created_at: string
          description: string | null
          id: string
          is_system: boolean
          name: string
          updated_at: string
        }
        Insert: {
          account_id: string
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roles_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_memberships: {
        Row: {
          account_id: string
          created_at: string
          id: string
          joined_at: string | null
          role_id: string | null
          salon_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          joined_at?: string | null
          role_id?: string | null
          salon_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          joined_at?: string | null
          role_id?: string | null
          salon_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "salon_memberships_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_memberships_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_memberships_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_payroll_settings: {
        Row: {
          biweekly_anchor_date: string | null
          created_at: string
          cycle_type: string
          id: string
          salon_id: string
          updated_at: string
        }
        Insert: {
          biweekly_anchor_date?: string | null
          created_at?: string
          cycle_type?: string
          id?: string
          salon_id: string
          updated_at?: string
        }
        Update: {
          biweekly_anchor_date?: string | null
          created_at?: string
          cycle_type?: string
          id?: string
          salon_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "salon_payroll_settings_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: true
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_profile_booking_requests: {
        Row: {
          created_at: string
          customer_user_id: string | null
          id: string
          look_id: string | null
          private_note: string | null
          requested_start_at: string | null
          salon_id: string
          service_id: string | null
          staff_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_user_id?: string | null
          id?: string
          look_id?: string | null
          private_note?: string | null
          requested_start_at?: string | null
          salon_id: string
          service_id?: string | null
          staff_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_user_id?: string | null
          id?: string
          look_id?: string | null
          private_note?: string | null
          requested_start_at?: string | null
          salon_id?: string
          service_id?: string | null
          staff_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "salon_profile_booking_requests_customer_user_id_fkey"
            columns: ["customer_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_booking_requests_look_id_fkey"
            columns: ["look_id"]
            isOneToOne: false
            referencedRelation: "salon_profile_looks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_booking_requests_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_booking_requests_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_booking_requests_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_profile_comments: {
        Row: {
          author_display_name: string | null
          author_user_id: string | null
          body: string
          created_at: string
          id: string
          is_salon_reply: boolean
          look_id: string | null
          parent_comment_id: string | null
          salon_id: string
          status: string
          update_id: string | null
          updated_at: string
        }
        Insert: {
          author_display_name?: string | null
          author_user_id?: string | null
          body: string
          created_at?: string
          id?: string
          is_salon_reply?: boolean
          look_id?: string | null
          parent_comment_id?: string | null
          salon_id: string
          status?: string
          update_id?: string | null
          updated_at?: string
        }
        Update: {
          author_display_name?: string | null
          author_user_id?: string | null
          body?: string
          created_at?: string
          id?: string
          is_salon_reply?: boolean
          look_id?: string | null
          parent_comment_id?: string | null
          salon_id?: string
          status?: string
          update_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "salon_profile_comments_author_user_id_fkey"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_comments_look_id_fkey"
            columns: ["look_id"]
            isOneToOne: false
            referencedRelation: "salon_profile_looks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_comments_parent_comment_id_fkey"
            columns: ["parent_comment_id"]
            isOneToOne: false
            referencedRelation: "salon_profile_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_comments_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_comments_update_id_fkey"
            columns: ["update_id"]
            isOneToOne: false
            referencedRelation: "salon_profile_updates"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_profile_content_booking_configs: {
        Row: {
          booking_cta_enabled: boolean
          booking_note: string | null
          created_at: string
          credited_staff_id: string | null
          cta_label: string | null
          id: string
          look_id: string | null
          primary_service_id: string | null
          salon_id: string
          source_type: string
          update_id: string | null
          updated_at: string
        }
        Insert: {
          booking_cta_enabled?: boolean
          booking_note?: string | null
          created_at?: string
          credited_staff_id?: string | null
          cta_label?: string | null
          id?: string
          look_id?: string | null
          primary_service_id?: string | null
          salon_id: string
          source_type: string
          update_id?: string | null
          updated_at?: string
        }
        Update: {
          booking_cta_enabled?: boolean
          booking_note?: string | null
          created_at?: string
          credited_staff_id?: string | null
          cta_label?: string | null
          id?: string
          look_id?: string | null
          primary_service_id?: string | null
          salon_id?: string
          source_type?: string
          update_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "salon_profile_content_booking_configs_credited_staff_id_fkey"
            columns: ["credited_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_content_booking_configs_look_id_fkey"
            columns: ["look_id"]
            isOneToOne: false
            referencedRelation: "salon_profile_looks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_content_booking_configs_primary_service_id_fkey"
            columns: ["primary_service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_content_booking_configs_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_content_booking_configs_update_id_fkey"
            columns: ["update_id"]
            isOneToOne: false
            referencedRelation: "salon_profile_updates"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_profile_content_booking_services: {
        Row: {
          config_id: string
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          parent_service_id: string | null
          salon_id: string
          service_id: string
          service_role: string
          updated_at: string
        }
        Insert: {
          config_id: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          parent_service_id?: string | null
          salon_id: string
          service_id: string
          service_role?: string
          updated_at?: string
        }
        Update: {
          config_id?: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          parent_service_id?: string | null
          salon_id?: string
          service_id?: string
          service_role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "salon_profile_content_booking_services_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "salon_profile_content_booking_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_content_booking_services_parent_service_id_fkey"
            columns: ["parent_service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_content_booking_services_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_content_booking_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_profile_entitlement_definitions: {
        Row: {
          code: string
          created_at: string
          description: string | null
          name: string
          updated_at: string
          value_type: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          name: string
          updated_at?: string
          value_type?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          name?: string
          updated_at?: string
          value_type?: string
        }
        Relationships: []
      }
      salon_profile_entitlement_overrides: {
        Row: {
          account_id: string
          created_at: string
          entitlement_code: string
          expires_at: string | null
          id: string
          limit_value: number
          period: string
          reason: string | null
          salon_id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          entitlement_code: string
          expires_at?: string | null
          id?: string
          limit_value: number
          period?: string
          reason?: string | null
          salon_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          entitlement_code?: string
          expires_at?: string | null
          id?: string
          limit_value?: number
          period?: string
          reason?: string | null
          salon_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "salon_profile_entitlement_overrides_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_entitlement_overrides_entitlement_code_fkey"
            columns: ["entitlement_code"]
            isOneToOne: false
            referencedRelation: "salon_profile_entitlement_definitions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "salon_profile_entitlement_overrides_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_profile_follows: {
        Row: {
          created_at: string
          id: string
          salon_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          salon_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          salon_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "salon_profile_follows_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_follows_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_profile_hashtags: {
        Row: {
          created_at: string
          id: string
          tag: string
        }
        Insert: {
          created_at?: string
          id?: string
          tag: string
        }
        Update: {
          created_at?: string
          id?: string
          tag?: string
        }
        Relationships: []
      }
      salon_profile_look_hashtags: {
        Row: {
          created_at: string
          hashtag_id: string
          id: string
          look_id: string
          salon_id: string
        }
        Insert: {
          created_at?: string
          hashtag_id: string
          id?: string
          look_id: string
          salon_id: string
        }
        Update: {
          created_at?: string
          hashtag_id?: string
          id?: string
          look_id?: string
          salon_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "salon_profile_look_hashtags_hashtag_id_fkey"
            columns: ["hashtag_id"]
            isOneToOne: false
            referencedRelation: "salon_profile_hashtags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_look_hashtags_look_id_fkey"
            columns: ["look_id"]
            isOneToOne: false
            referencedRelation: "salon_profile_looks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_look_hashtags_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_profile_look_saves: {
        Row: {
          created_at: string
          id: string
          look_id: string
          salon_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          look_id: string
          salon_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          look_id?: string
          salon_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "salon_profile_look_saves_look_id_fkey"
            columns: ["look_id"]
            isOneToOne: false
            referencedRelation: "salon_profile_looks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_look_saves_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_look_saves_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_profile_looks: {
        Row: {
          author_avatar_path: string | null
          author_display_name: string | null
          author_staff_id: string | null
          author_user_id: string | null
          badge: string | null
          booking_note: string | null
          caption: string | null
          created_at: string
          created_by_user_id: string | null
          duration_minutes: number | null
          emotional_description: string | null
          id: string
          is_pinned: boolean
          media_path: string | null
          mood: string | null
          palette: string[]
          published_at: string | null
          recommended_staff_id: string | null
          salon_id: string
          service_id: string | null
          starting_price: number | null
          status: string
          title: string
          updated_at: string
          why_love_it: string | null
        }
        Insert: {
          author_avatar_path?: string | null
          author_display_name?: string | null
          author_staff_id?: string | null
          author_user_id?: string | null
          badge?: string | null
          booking_note?: string | null
          caption?: string | null
          created_at?: string
          created_by_user_id?: string | null
          duration_minutes?: number | null
          emotional_description?: string | null
          id?: string
          is_pinned?: boolean
          media_path?: string | null
          mood?: string | null
          palette?: string[]
          published_at?: string | null
          recommended_staff_id?: string | null
          salon_id: string
          service_id?: string | null
          starting_price?: number | null
          status?: string
          title: string
          updated_at?: string
          why_love_it?: string | null
        }
        Update: {
          author_avatar_path?: string | null
          author_display_name?: string | null
          author_staff_id?: string | null
          author_user_id?: string | null
          badge?: string | null
          booking_note?: string | null
          caption?: string | null
          created_at?: string
          created_by_user_id?: string | null
          duration_minutes?: number | null
          emotional_description?: string | null
          id?: string
          is_pinned?: boolean
          media_path?: string | null
          mood?: string | null
          palette?: string[]
          published_at?: string | null
          recommended_staff_id?: string | null
          salon_id?: string
          service_id?: string | null
          starting_price?: number | null
          status?: string
          title?: string
          updated_at?: string
          why_love_it?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "salon_profile_looks_author_staff_id_fkey"
            columns: ["author_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_looks_author_user_id_fkey"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_looks_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_looks_recommended_staff_id_fkey"
            columns: ["recommended_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_looks_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_looks_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_profile_media_assets: {
        Row: {
          attached_at: string | null
          attached_entity_id: string | null
          attached_entity_type: string | null
          bucket: string
          checksum: string | null
          created_at: string
          deleted_at: string | null
          expires_at: string
          height: number | null
          id: string
          mime_type: string | null
          object_path: string
          original_bytes: number | null
          orphaned_at: string | null
          processed_bytes: number | null
          purpose: string
          quarantined_at: string | null
          salon_id: string
          status: string
          updated_at: string
          upload_intent: string | null
          uploaded_by_user_id: string | null
          width: number | null
        }
        Insert: {
          attached_at?: string | null
          attached_entity_id?: string | null
          attached_entity_type?: string | null
          bucket?: string
          checksum?: string | null
          created_at?: string
          deleted_at?: string | null
          expires_at?: string
          height?: number | null
          id?: string
          mime_type?: string | null
          object_path: string
          original_bytes?: number | null
          orphaned_at?: string | null
          processed_bytes?: number | null
          purpose: string
          quarantined_at?: string | null
          salon_id: string
          status?: string
          updated_at?: string
          upload_intent?: string | null
          uploaded_by_user_id?: string | null
          width?: number | null
        }
        Update: {
          attached_at?: string | null
          attached_entity_id?: string | null
          attached_entity_type?: string | null
          bucket?: string
          checksum?: string | null
          created_at?: string
          deleted_at?: string | null
          expires_at?: string
          height?: number | null
          id?: string
          mime_type?: string | null
          object_path?: string
          original_bytes?: number | null
          orphaned_at?: string | null
          processed_bytes?: number | null
          purpose?: string
          quarantined_at?: string | null
          salon_id?: string
          status?: string
          updated_at?: string
          upload_intent?: string | null
          uploaded_by_user_id?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "salon_profile_media_assets_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_media_assets_uploaded_by_user_id_fkey"
            columns: ["uploaded_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_profile_plan_catalog: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id: string
          is_active?: boolean
          is_default?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      salon_profile_plan_entitlements: {
        Row: {
          created_at: string
          entitlement_code: string
          limit_value: number
          period: string
          plan_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          entitlement_code: string
          limit_value: number
          period?: string
          plan_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          entitlement_code?: string
          limit_value?: number
          period?: string
          plan_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "salon_profile_plan_entitlements_entitlement_code_fkey"
            columns: ["entitlement_code"]
            isOneToOne: false
            referencedRelation: "salon_profile_entitlement_definitions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "salon_profile_plan_entitlements_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "salon_profile_plan_catalog"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_profile_review_replies: {
        Row: {
          author_user_id: string
          body: string
          created_at: string
          created_by_user_id: string | null
          id: string
          moderation_status: string
          review_id: string
          salon_id: string
          updated_at: string
        }
        Insert: {
          author_user_id: string
          body: string
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          moderation_status?: string
          review_id: string
          salon_id: string
          updated_at?: string
        }
        Update: {
          author_user_id?: string
          body?: string
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          moderation_status?: string
          review_id?: string
          salon_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "salon_profile_review_replies_author_user_id_fkey"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_review_replies_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_review_replies_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "salon_profile_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_review_replies_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_profile_reviews: {
        Row: {
          author_user_id: string
          body: string
          created_at: string
          edited_at: string | null
          id: string
          moderation_reason: string | null
          moderation_status: string
          rating: number
          salon_id: string
          title: string | null
          updated_at: string
          verification_status: string
          verified_booking_id: string | null
        }
        Insert: {
          author_user_id: string
          body: string
          created_at?: string
          edited_at?: string | null
          id?: string
          moderation_reason?: string | null
          moderation_status?: string
          rating: number
          salon_id: string
          title?: string | null
          updated_at?: string
          verification_status?: string
          verified_booking_id?: string | null
        }
        Update: {
          author_user_id?: string
          body?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          moderation_reason?: string | null
          moderation_status?: string
          rating?: number
          salon_id?: string
          title?: string | null
          updated_at?: string
          verification_status?: string
          verified_booking_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "salon_profile_reviews_author_user_id_fkey"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_reviews_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_reviews_verified_booking_id_fkey"
            columns: ["verified_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_profile_subscriptions: {
        Row: {
          account_id: string
          created_at: string
          ends_at: string | null
          id: string
          plan_id: string
          salon_id: string
          starts_at: string
          status: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          ends_at?: string | null
          id?: string
          plan_id: string
          salon_id: string
          starts_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          ends_at?: string | null
          id?: string
          plan_id?: string
          salon_id?: string
          starts_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "salon_profile_subscriptions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "salon_profile_plan_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_subscriptions_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_profile_update_hashtags: {
        Row: {
          created_at: string
          hashtag_id: string
          id: string
          salon_id: string
          update_id: string
        }
        Insert: {
          created_at?: string
          hashtag_id: string
          id?: string
          salon_id: string
          update_id: string
        }
        Update: {
          created_at?: string
          hashtag_id?: string
          id?: string
          salon_id?: string
          update_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "salon_profile_update_hashtags_hashtag_id_fkey"
            columns: ["hashtag_id"]
            isOneToOne: false
            referencedRelation: "salon_profile_hashtags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_update_hashtags_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_update_hashtags_update_id_fkey"
            columns: ["update_id"]
            isOneToOne: false
            referencedRelation: "salon_profile_updates"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_profile_updates: {
        Row: {
          author_avatar_path: string | null
          author_display_name: string | null
          author_staff_id: string | null
          author_user_id: string | null
          caption: string | null
          created_at: string
          created_by_user_id: string | null
          cta_label: string | null
          ends_at: string | null
          id: string
          media_path: string | null
          published_at: string | null
          salon_id: string
          service_id: string | null
          staff_id: string | null
          starts_at: string | null
          status: string
          summary: string | null
          title: string
          update_type: string
          updated_at: string
        }
        Insert: {
          author_avatar_path?: string | null
          author_display_name?: string | null
          author_staff_id?: string | null
          author_user_id?: string | null
          caption?: string | null
          created_at?: string
          created_by_user_id?: string | null
          cta_label?: string | null
          ends_at?: string | null
          id?: string
          media_path?: string | null
          published_at?: string | null
          salon_id: string
          service_id?: string | null
          staff_id?: string | null
          starts_at?: string | null
          status?: string
          summary?: string | null
          title: string
          update_type?: string
          updated_at?: string
        }
        Update: {
          author_avatar_path?: string | null
          author_display_name?: string | null
          author_staff_id?: string | null
          author_user_id?: string | null
          caption?: string | null
          created_at?: string
          created_by_user_id?: string | null
          cta_label?: string | null
          ends_at?: string | null
          id?: string
          media_path?: string | null
          published_at?: string | null
          salon_id?: string
          service_id?: string | null
          staff_id?: string | null
          starts_at?: string | null
          status?: string
          summary?: string | null
          title?: string
          update_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "salon_profile_updates_author_staff_id_fkey"
            columns: ["author_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_updates_author_user_id_fkey"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_updates_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_updates_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_updates_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_updates_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_profile_usage_events: {
        Row: {
          account_id: string
          created_at: string
          entity_id: string | null
          entity_type: string | null
          event_type: string
          id: string
          idempotency_key: string | null
          occurred_at: string
          quantity: number
          salon_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type: string
          id?: string
          idempotency_key?: string | null
          occurred_at?: string
          quantity?: number
          salon_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type?: string
          id?: string
          idempotency_key?: string | null
          occurred_at?: string
          quantity?: number
          salon_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "salon_profile_usage_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_profile_usage_events_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_settings: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          allow_staff_applications: boolean
          business_description: string | null
          business_name: string
          city: string | null
          country: string | null
          created_at: string
          email: string | null
          id: string
          phone: string | null
          postal_code: string | null
          public_discovery_enabled: boolean
          public_discovery_published_at: string | null
          public_profile_cover_path: string | null
          public_profile_logo_path: string | null
          public_profile_story: string | null
          public_profile_tagline: string | null
          salon_id: string
          state: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          allow_staff_applications?: boolean
          business_description?: string | null
          business_name: string
          city?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          id?: string
          phone?: string | null
          postal_code?: string | null
          public_discovery_enabled?: boolean
          public_discovery_published_at?: string | null
          public_profile_cover_path?: string | null
          public_profile_logo_path?: string | null
          public_profile_story?: string | null
          public_profile_tagline?: string | null
          salon_id: string
          state?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          allow_staff_applications?: boolean
          business_description?: string | null
          business_name?: string
          city?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          id?: string
          phone?: string | null
          postal_code?: string | null
          public_discovery_enabled?: boolean
          public_discovery_published_at?: string | null
          public_profile_cover_path?: string | null
          public_profile_logo_path?: string | null
          public_profile_story?: string | null
          public_profile_tagline?: string | null
          salon_id?: string
          state?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "salon_settings_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: true
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      service_add_on_links: {
        Row: {
          add_on_service_id: string
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          parent_service_id: string
          salon_id: string
          updated_at: string
        }
        Insert: {
          add_on_service_id: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          parent_service_id: string
          salon_id: string
          updated_at?: string
        }
        Update: {
          add_on_service_id?: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          parent_service_id?: string
          salon_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_add_on_links_add_on_service_id_fkey"
            columns: ["add_on_service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_add_on_links_parent_service_id_fkey"
            columns: ["parent_service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_add_on_links_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          base_price: number
          category: string | null
          created_at: string
          description: string | null
          duration_minutes: number
          id: string
          is_active: boolean
          name: string
          online_booking_enabled: boolean
          salon_id: string
          updated_at: string
        }
        Insert: {
          base_price?: number
          category?: string | null
          created_at?: string
          description?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean
          name: string
          online_booking_enabled?: boolean
          salon_id: string
          updated_at?: string
        }
        Update: {
          base_price?: number
          category?: string | null
          created_at?: string
          description?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean
          name?: string
          online_booking_enabled?: boolean
          salon_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          account_user_id: string | null
          address_line1: string | null
          address_line2: string | null
          city: string | null
          created_at: string
          display_name: string
          email: string | null
          first_name: string | null
          id: string
          is_active: boolean
          job_title: string | null
          last_name: string | null
          online_booking_enabled: boolean
          owner_public_enabled: boolean
          passcode_digest: string
          passcode_is_default: boolean
          passcode_salt: string
          phone: string | null
          pos_enabled: boolean
          postal_code: string | null
          profile_display_order: number
          public_bio: string | null
          public_profile_photo_path: string | null
          public_profile_visible: boolean
          salon_id: string
          salon_profile_content_posting_enabled: boolean
          specialties: string[]
          staff_public_consent_status: string
          state: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          account_user_id?: string | null
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          created_at?: string
          display_name: string
          email?: string | null
          first_name?: string | null
          id?: string
          is_active?: boolean
          job_title?: string | null
          last_name?: string | null
          online_booking_enabled?: boolean
          owner_public_enabled?: boolean
          passcode_digest?: string
          passcode_is_default?: boolean
          passcode_salt?: string
          phone?: string | null
          pos_enabled?: boolean
          postal_code?: string | null
          profile_display_order?: number
          public_bio?: string | null
          public_profile_photo_path?: string | null
          public_profile_visible?: boolean
          salon_id: string
          salon_profile_content_posting_enabled?: boolean
          specialties?: string[]
          staff_public_consent_status?: string
          state?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          account_user_id?: string | null
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          created_at?: string
          display_name?: string
          email?: string | null
          first_name?: string | null
          id?: string
          is_active?: boolean
          job_title?: string | null
          last_name?: string | null
          online_booking_enabled?: boolean
          owner_public_enabled?: boolean
          passcode_digest?: string
          passcode_is_default?: boolean
          passcode_salt?: string
          phone?: string | null
          pos_enabled?: boolean
          postal_code?: string | null
          profile_display_order?: number
          public_bio?: string | null
          public_profile_photo_path?: string | null
          public_profile_visible?: boolean
          salon_id?: string
          salon_profile_content_posting_enabled?: boolean
          specialties?: string[]
          staff_public_consent_status?: string
          state?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_account_user_id_fkey"
            columns: ["account_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_availability_rules: {
        Row: {
          created_at: string
          created_by_user_id: string | null
          day_of_week: number
          effective_end_date: string | null
          effective_start_date: string | null
          ends_at_local: string
          id: string
          is_active: boolean
          rule_type: string
          salon_id: string
          staff_id: string | null
          starts_at_local: string
          timezone_iana: string
          updated_at: string
          updated_by_user_id: string | null
        }
        Insert: {
          created_at?: string
          created_by_user_id?: string | null
          day_of_week: number
          effective_end_date?: string | null
          effective_start_date?: string | null
          ends_at_local: string
          id?: string
          is_active?: boolean
          rule_type?: string
          salon_id: string
          staff_id?: string | null
          starts_at_local: string
          timezone_iana?: string
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Update: {
          created_at?: string
          created_by_user_id?: string | null
          day_of_week?: number
          effective_end_date?: string | null
          effective_start_date?: string | null
          ends_at_local?: string
          id?: string
          is_active?: boolean
          rule_type?: string
          salon_id?: string
          staff_id?: string | null
          starts_at_local?: string
          timezone_iana?: string
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_availability_rules_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_availability_rules_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_availability_rules_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_availability_rules_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_payroll_settings: {
        Row: {
          apply_tax_to_fixed_pay: boolean
          bonus_payout_method: string
          cash_to_tax_company: boolean
          check_rate: number
          commission_rate: number
          created_at: string
          effective_from: string
          effective_to: string | null
          fixed_pay_amount: number
          id: string
          legal_name: string | null
          pay_type: string
          salon_id: string
          staff_id: string
          tax_bonus: boolean
          tax_company_enabled: boolean
          tax_rate: number
          tax_tips: boolean
          tip_payout_method: string
          updated_at: string
        }
        Insert: {
          apply_tax_to_fixed_pay?: boolean
          bonus_payout_method?: string
          cash_to_tax_company?: boolean
          check_rate?: number
          commission_rate?: number
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          fixed_pay_amount?: number
          id?: string
          legal_name?: string | null
          pay_type?: string
          salon_id: string
          staff_id: string
          tax_bonus?: boolean
          tax_company_enabled?: boolean
          tax_rate?: number
          tax_tips?: boolean
          tip_payout_method?: string
          updated_at?: string
        }
        Update: {
          apply_tax_to_fixed_pay?: boolean
          bonus_payout_method?: string
          cash_to_tax_company?: boolean
          check_rate?: number
          commission_rate?: number
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          fixed_pay_amount?: number
          id?: string
          legal_name?: string | null
          pay_type?: string
          salon_id?: string
          staff_id?: string
          tax_bonus?: boolean
          tax_company_enabled?: boolean
          tax_rate?: number
          tax_tips?: boolean
          tip_payout_method?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_payroll_settings_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_payroll_settings_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_salon_connection_requests: {
        Row: {
          accepted_at: string | null
          account_user_id: string | null
          cancelled_at: string | null
          created_at: string
          declined_at: string | null
          direction: string
          expires_at: string | null
          id: string
          initiated_by_user_id: string
          message: string | null
          requested_job_title: string | null
          reviewed_by_user_id: string | null
          revoked_at: string | null
          salon_id: string
          staff_id: string | null
          status: string
          target_email_normalized: string | null
          target_phone_e164: string | null
          token_hash: string | null
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          account_user_id?: string | null
          cancelled_at?: string | null
          created_at?: string
          declined_at?: string | null
          direction: string
          expires_at?: string | null
          id?: string
          initiated_by_user_id: string
          message?: string | null
          requested_job_title?: string | null
          reviewed_by_user_id?: string | null
          revoked_at?: string | null
          salon_id: string
          staff_id?: string | null
          status?: string
          target_email_normalized?: string | null
          target_phone_e164?: string | null
          token_hash?: string | null
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          account_user_id?: string | null
          cancelled_at?: string | null
          created_at?: string
          declined_at?: string | null
          direction?: string
          expires_at?: string | null
          id?: string
          initiated_by_user_id?: string
          message?: string | null
          requested_job_title?: string | null
          reviewed_by_user_id?: string | null
          revoked_at?: string | null
          salon_id?: string
          staff_id?: string | null
          status?: string
          target_email_normalized?: string | null
          target_phone_e164?: string | null
          token_hash?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_salon_connection_requests_account_user_id_fkey"
            columns: ["account_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_salon_connection_requests_initiated_by_user_id_fkey"
            columns: ["initiated_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_salon_connection_requests_reviewed_by_user_id_fkey"
            columns: ["reviewed_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_salon_connection_requests_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_salon_connection_requests_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_service_assignments: {
        Row: {
          created_at: string
          created_by_user_id: string | null
          custom_duration_minutes: number | null
          custom_price: number | null
          effective_end_date: string | null
          effective_start_date: string | null
          id: string
          is_active: boolean
          online_bookable: boolean
          salon_id: string
          service_id: string
          staff_id: string
          updated_at: string
          updated_by_user_id: string | null
        }
        Insert: {
          created_at?: string
          created_by_user_id?: string | null
          custom_duration_minutes?: number | null
          custom_price?: number | null
          effective_end_date?: string | null
          effective_start_date?: string | null
          id?: string
          is_active?: boolean
          online_bookable?: boolean
          salon_id: string
          service_id: string
          staff_id: string
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Update: {
          created_at?: string
          created_by_user_id?: string | null
          custom_duration_minutes?: number | null
          custom_price?: number | null
          effective_end_date?: string | null
          effective_start_date?: string | null
          id?: string
          is_active?: boolean
          online_bookable?: boolean
          salon_id?: string
          service_id?: string
          staff_id?: string
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_service_assignments_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_service_assignments_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_service_assignments_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_service_assignments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_service_assignments_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_time_blocks: {
        Row: {
          block_type: string
          cancelled_at: string | null
          cancelled_by_user_id: string | null
          created_at: string
          created_by_user_id: string | null
          ends_at: string
          id: string
          is_active: boolean
          reason: string | null
          salon_id: string
          staff_id: string | null
          starts_at: string
          timezone_iana: string
          updated_at: string
          updated_by_user_id: string | null
        }
        Insert: {
          block_type: string
          cancelled_at?: string | null
          cancelled_by_user_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          ends_at: string
          id?: string
          is_active?: boolean
          reason?: string | null
          salon_id: string
          staff_id?: string | null
          starts_at: string
          timezone_iana?: string
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Update: {
          block_type?: string
          cancelled_at?: string | null
          cancelled_by_user_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          ends_at?: string
          id?: string
          is_active?: boolean
          reason?: string | null
          salon_id?: string
          staff_id?: string | null
          starts_at?: string
          timezone_iana?: string
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_time_blocks_cancelled_by_user_id_fkey"
            columns: ["cancelled_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_time_blocks_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_time_blocks_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_time_blocks_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_time_blocks_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_workdays: {
        Row: {
          auto_checked_out_at: string | null
          check_in_at: string | null
          check_in_sequence: number | null
          check_out_at: string | null
          created_at: string
          id: string
          last_leave_at: string | null
          leave_baseline_turn_count: number | null
          leave_cohort_staff_ids: string[]
          queue_turn_count: number
          salon_id: string
          staff_id: string
          status: string
          updated_at: string
          work_date: string
        }
        Insert: {
          auto_checked_out_at?: string | null
          check_in_at?: string | null
          check_in_sequence?: number | null
          check_out_at?: string | null
          created_at?: string
          id?: string
          last_leave_at?: string | null
          leave_baseline_turn_count?: number | null
          leave_cohort_staff_ids?: string[]
          queue_turn_count?: number
          salon_id: string
          staff_id: string
          status?: string
          updated_at?: string
          work_date: string
        }
        Update: {
          auto_checked_out_at?: string | null
          check_in_at?: string | null
          check_in_sequence?: number | null
          check_out_at?: string | null
          created_at?: string
          id?: string
          last_leave_at?: string | null
          leave_baseline_turn_count?: number | null
          leave_cohort_staff_ids?: string[]
          queue_turn_count?: number
          salon_id?: string
          staff_id?: string
          status?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_workdays_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_workdays_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          auth_user_id: string | null
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string | null
          first_name: string | null
          id: string
          language: string
          last_login_at: string | null
          last_name: string | null
          phone: string | null
          status: string
          timezone: string
          updated_at: string
        }
        Insert: {
          auth_user_id?: string | null
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          language?: string
          last_login_at?: string | null
          last_name?: string | null
          phone?: string | null
          status?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          auth_user_id?: string | null
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          language?: string
          last_login_at?: string | null
          last_name?: string | null
          phone?: string | null
          status?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_staff_connection_invite: {
        Args: { p_token: string }
        Returns: Json
      }
      accept_staff_connection_invite_by_request: {
        Args: { p_request_id: string }
        Returns: Json
      }
      apply_staff_connection_invite_decision: {
        Args: {
          p_decision?: string
          p_request_id?: string
          p_token_hash?: string
        }
        Returns: Json
      }
      adjust_pos_portable_staff_turn: {
        Args: {
          p_delta: number
          p_key_id: string
          p_operator_passcode: string
          p_operator_staff_id: string
          p_reason: string
          p_session_signature: string
          p_target_staff_id: string
        }
        Returns: Json
      }
      auto_close_stale_staff_workdays: {
        Args: { p_salon_id: string; p_today: string }
        Returns: undefined
      }
      cancel_customer_booking: {
        Args: { p_booking_id: string; p_reason?: string }
        Returns: Json
      }
      cancel_public_booking_by_manage_token: {
        Args: { p_reason?: string; raw_token: string }
        Returns: Json
      }
      cancel_staff_salon_application: {
        Args: { p_request_id: string }
        Returns: Json
      }
      cancel_staff_time_block: {
        Args: { p_block_id: string; p_salon_id: string }
        Returns: undefined
      }
      claim_guest_booking_by_manage_token: {
        Args: { raw_token: string }
        Returns: Json
      }
      complete_assigned_booking_line: {
        Args: { p_booking_line_id: string; p_service_note?: string }
        Returns: Json
      }
      confirm_assigned_booking: {
        Args: { p_booking_id: string }
        Returns: Json
      }
      confirm_pos_display_channel_tip: {
        Args: { p_customer_message: Json; p_token: string }
        Returns: Json
      }
      confirm_pos_live_draft_customer: {
        Args: { p_customer_id: string; p_request_id?: string; p_token: string }
        Returns: Json
      }
      confirm_pos_live_draft_tip: {
        Args: { p_request_id?: string; p_tip_amount: number; p_token: string }
        Returns: Json
      }
      convert_booking_to_pos_ticket: {
        Args: { p_booking_id: string }
        Returns: string
      }
      create_account_salon: {
        Args: {
          p_account_id: string
          p_address_line1?: string
          p_address_line2?: string
          p_city?: string
          p_country?: string
          p_create_request_key: string
          p_name: string
          p_phone?: string
          p_postal_code?: string
          p_state?: string
        }
        Returns: Json
      }
      create_canonical_booking: {
        Args: {
          p_actor_source: string
          p_confirmation_mode: string
          p_confirmation_status: string
          p_customer_id: string
          p_customer_user_id: string
          p_end_at: string
          p_idempotency_key: string
          p_internal_notes: string
          p_lines: Json
          p_overbooking_override_reason: string
          p_public_notes: string
          p_salon_id: string
          p_source: string
          p_start_at: string
          p_status: string
        }
        Returns: string
      }
      create_pos_desk_customer_by_token: {
        Args: {
          p_customer_lookup: string
          p_customer_name: string
          p_token: string
        }
        Returns: Json
      }
      create_pos_live_draft_customer_by_phone: {
        Args: { p_name: string; p_phone: string; p_token: string }
        Returns: Json
      }
      create_pos_portable_customer: {
        Args: {
          p_email?: string
          p_key_id: string
          p_name: string
          p_phone?: string
          p_session_signature: string
        }
        Returns: Json
      }
      create_public_booking: {
        Args: {
          p_customer_email: string
          p_customer_first_name: string
          p_customer_last_name: string
          p_customer_phone: string
          p_end_at: string
          p_idempotency_key?: string
          p_lines: Json
          p_public_notes?: string
          p_salon_id: string
          p_source?: string
          p_source_reference_id?: string
          p_source_reference_type?: string
          p_start_at: string
        }
        Returns: Json
      }
      create_staff_time_block: {
        Args: {
          p_block_type: string
          p_ends_at: string
          p_override_conflicts?: boolean
          p_reason?: string
          p_salon_id: string
          p_staff_id: string
          p_starts_at: string
          p_timezone_iana?: string
        }
        Returns: Json
      }
      current_public_user_id: { Args: never; Returns: string }
      current_user_staff_id_for_salon: {
        Args: { target_salon_id: string }
        Returns: string
      }
      decline_staff_connection_invite: {
        Args: { p_token: string }
        Returns: Json
      }
      decline_staff_connection_invite_by_request: {
        Args: { p_request_id: string }
        Returns: Json
      }
      ensure_personal_account_for_current_user: {
        Args: { p_account_name?: string }
        Returns: {
          account_id: string
          account_membership_id: string
          created_account: boolean
          created_membership: boolean
        }[]
      }
      finalize_pos_portable_live_draft: {
        Args: {
          p_key_id: string
          p_reset_seconds?: number
          p_session_signature: string
          p_token: string
        }
        Returns: Json
      }
      find_pos_live_draft_customer_by_phone: {
        Args: { p_phone: string; p_token: string }
        Returns: Json
      }
      get_customer_crm_metrics: {
        Args: { p_customer_ids: string[]; p_salon_id: string }
        Returns: {
          active_pos_ticket_count: number
          appointment_count: number
          cancelled_count: number
          completed_count: number
          customer_id: string
          finalized_pos_ticket_count: number
          finalized_spend: number
          last_visit_at: string
          no_show_count: number
          upcoming_booking_id: string
          upcoming_start_at: string
        }[]
      }
      get_pos_customer_display_settings_by_token: {
        Args: { p_token: string }
        Returns: Json
      }
      get_pos_desk_session_by_token: {
        Args: { p_token: string }
        Returns: Json
      }
      get_pos_display_channel_by_token: {
        Args: { p_token: string }
        Returns: Json
      }
      get_pos_live_draft_by_token: {
        Args: { p_token: string }
        Returns: {
          completed_at: string
          customer: Json
          customer_version: number
          discount: number
          id: string
          last_customer_action_id: string
          last_tip_action_id: string
          receipt_version: number
          reset_at: string
          salon_id: string
          selected_staff_id: string
          server_now: string
          staff_lines: Json
          status: string
          subtotal: number
          tax: number
          tip: number
          token: string
          total: number
          total_before_tip: number
          updated_at: string
          version: number
        }[]
      }
      get_pos_portable_access_context: {
        Args: { p_key_id: string; p_session_signature: string }
        Returns: Json
      }
      get_pos_portable_check_in_data: {
        Args: { p_key_id: string; p_session_signature: string }
        Returns: Json
      }
      get_pos_portable_desk_data: {
        Args: {
          p_key_id: string
          p_session_signature: string
          p_work_date?: string
        }
        Returns: Json
      }
      get_pos_setting_payload: {
        Args: { target_salon_id: string }
        Returns: Json
      }
      get_salon_business_date: {
        Args: { p_salon_id: string }
        Returns: string
      }
      get_salon_business_timezone: {
        Args: { p_salon_id: string }
        Returns: string
      }
      get_public_booking_by_manage_token: {
        Args: { raw_token: string }
        Returns: Json
      }
      get_public_booking_context: {
        Args: {
          p_range_end: string
          p_range_start: string
          target_salon_id: string
        }
        Returns: Json
      }
      get_public_content_booking_options: {
        Args: { target_salon_ids?: string[] }
        Returns: {
          add_ons: Json
          additional_services: Json
          booking_cta_enabled: boolean
          booking_enabled: boolean
          booking_href: string
          booking_note: string
          caption: string
          content_id: string
          content_type: string
          credited_staff_id: string
          credited_staff_name: string
          cta_label: string
          media_bucket: string
          media_path: string
          primary_service_base_price: number
          primary_service_duration_minutes: number
          primary_service_id: string
          primary_service_name: string
          readiness_message: string
          readiness_state: string
          salon_id: string
          source_type: string
          title: string
        }[]
      }
      get_public_beauty_post_booking_counts: {
        Args: { p_post_ids?: string[] }
        Returns: {
          post_id: string
          verified_booking_count: number
        }[]
      }
      get_public_explore_decision_signals: {
        Args: { target_salon_ids?: string[] }
        Returns: {
          average_rating: number
          bookable_service_id: string
          bookable_service_name: string
          booking_enabled: boolean
          booking_href: string
          next_availability_label: string
          next_available_at: string
          review_count: number
          salon_id: string
        }[]
      }
      get_public_explore_home_salons: {
        Args: { p_new_limit?: number; p_recommended_limit?: number }
        Returns: {
          active_service_count: number
          address_line1: string
          address_line2: string
          city: string
          country: string
          cover_image_path: string
          created_at: string
          description: string
          featured_service_category: string
          featured_service_name: string
          has_public_profile: boolean
          home_rank: number
          is_new: boolean
          latest_media_created_at: string
          latitude: number
          longitude: number
          phone: string
          postal_code: string
          profile_completeness: number
          public_discovery_published_at: string
          salon_id: string
          salon_name: string
          section: string
          service_categories: string[]
          service_names: string[]
          starting_price: number
          state: string
          updated_at: string
        }[]
      }
      get_public_explore_inspiration: {
        Args: {
          p_cursor_media_id?: string
          p_cursor_published_at?: string
          p_page_size?: number
        }
        Returns: {
          aspect_ratio: number
          author_display_name: string
          author_is_anonymous: boolean
          bookable_service_id: string
          booking_enabled: boolean
          booking_href: string
          caption_excerpt: string
          content_id: string
          content_type: string
          image_height: number
          image_width: number
          media_id: string
          media_path: string
          published_at: string
          salon_city: string
          salon_id: string
          salon_name: string
          salon_phone: string
          salon_state: string
          service_category: string
          service_name: string
        }[]
      }
      get_public_explore_popular_services: {
        Args: { p_limit?: number }
        Returns: {
          active_service_count: number
          category: string
          salon_count: number
        }[]
      }
      get_public_salon_profile: {
        Args: { target_salon_id: string }
        Returns: {
          account_id: string
          active_service_count: number
          address_line1: string
          address_line2: string
          city: string
          country: string
          cover_path: string
          description: string
          email: string
          follower_count: number
          is_following: boolean
          logo_path: string
          phone: string
          postal_code: string
          public_discovery_published_at: string
          salon_id: string
          salon_name: string
          service_categories: string[]
          service_names: string[]
          state: string
          story: string
          tagline: string
          website: string
        }[]
      }
      get_public_salon_profile_comments: {
        Args: { target_salon_id: string }
        Returns: {
          author_display_name: string
          author_user_id: string
          body: string
          created_at: string
          id: string
          is_salon_reply: boolean
          look_id: string
          parent_comment_id: string
          salon_id: string
          update_id: string
          updated_at: string
        }[]
      }
      get_public_salon_profile_looks: {
        Args: { target_salon_id: string }
        Returns: {
          author_avatar_path: string
          author_display_name: string
          author_staff_id: string
          author_user_id: string
          badge: string
          booking_note: string
          caption: string
          comment_count: number
          duration_minutes: number
          emotional_description: string
          hashtags: string[]
          id: string
          is_pinned: boolean
          is_saved: boolean
          media_path: string
          mood: string
          palette: string[]
          published_at: string
          recommended_staff_id: string
          recommended_staff_name: string
          save_count: number
          service_id: string
          service_name: string
          starting_price: number
          title: string
          why_love_it: string
        }[]
      }
      get_public_salon_profile_review_summary: {
        Args: { target_salon_id: string }
        Returns: {
          average_rating: number
          rating_1_count: number
          rating_2_count: number
          rating_3_count: number
          rating_4_count: number
          rating_5_count: number
          review_count: number
          verified_count: number
        }[]
      }
      get_public_salon_profile_reviews: {
        Args: { target_salon_id: string }
        Returns: {
          author_display_name: string
          author_user_id: string
          body: string
          created_at: string
          edited_at: string
          id: string
          rating: number
          reply_body: string
          reply_created_at: string
          reply_id: string
          salon_id: string
          title: string
          updated_at: string
          verification_status: string
          verified_booking_id: string
        }[]
      }
      get_public_salon_profile_services: {
        Args: { target_salon_id: string }
        Returns: {
          base_price: number
          category: string
          description: string
          duration_minutes: number
          id: string
          name: string
        }[]
      }
      get_public_salon_profile_staff: {
        Args: { target_salon_id: string }
        Returns: {
          avatar_path: string
          bio: string
          display_name: string
          id: string
          job_title: string
          online_booking_enabled: boolean
          portfolio_count: number
          specialties: string[]
        }[]
      }
      get_public_salon_profile_updates: {
        Args: { target_salon_id: string }
        Returns: {
          author_avatar_path: string
          author_display_name: string
          author_staff_id: string
          author_user_id: string
          caption: string
          comment_count: number
          cta_label: string
          ends_at: string
          hashtags: string[]
          id: string
          media_path: string
          published_at: string
          service_id: string
          service_name: string
          staff_id: string
          staff_name: string
          starts_at: string
          summary: string
          title: string
          update_type: string
        }[]
      }
      get_salon_profile_entitlement_limit: {
        Args: { entitlement_key: string; target_salon_id: string }
        Returns: number
      }
      get_salon_profile_media_usage: {
        Args: { target_salon_id: string }
        Returns: {
          asset_count: number
          orphan_bytes: number
          remaining_bytes: number
          storage_quota_bytes: number
          used_bytes: number
        }[]
      }
      get_staff_connection_invite_by_token: {
        Args: { p_token: string }
        Returns: Json
      }
      list_account_favorite_customers: {
        Args: { p_limit?: number }
        Returns: {
          customer_id: string
          customer_name: string
          email: string
          favorite_id: string
          favorited_at: string
          phone: string
          salon_id: string
          salon_name: string
        }[]
      }
      list_account_favorite_shops: {
        Args: { p_limit?: number }
        Returns: {
          city: string
          follow_id: string
          followed_at: string
          salon_id: string
          salon_name: string
          state: string
        }[]
      }
      list_account_saved_posts: {
        Args: { p_limit?: number }
        Returns: {
          caption: string
          look_id: string
          media_path: string
          published_at: string
          salon_id: string
          salon_name: string
          saved_at: string
          saved_id: string
          title: string
        }[]
      }
      list_my_staff_salon_connection_requests: {
        Args: never
        Returns: {
          accepted_at: string
          address_line1: string
          address_line2: string
          cancelled_at: string
          city: string
          country: string
          created_at: string
          declined_at: string
          direction: string
          expires_at: string
          id: string
          message: string
          postal_code: string
          requested_job_title: string
          revoked_at: string
          salon_id: string
          salon_name: string
          staff_display_name: string
          staff_id: string
          staff_job_title: string
          state: string
          status: string
          target_masked_email: string
          target_masked_phone: string
          updated_at: string
        }[]
      }
      log_out_pos_portable_access: {
        Args: { p_key_id: string; p_session_signature: string }
        Returns: boolean
      }
      mask_staff_connection_email: {
        Args: { p_email: string }
        Returns: string
      }
      pos_portable_access_salon_id: {
        Args: { p_key_id: string; p_session_signature: string }
        Returns: string
      }
      pos_portable_access_signature: {
        Args: { p_key_id: string; p_passcode_digest: string }
        Returns: string
      }
      reschedule_canonical_booking: {
        Args: {
          p_booking_id: string
          p_end_at: string
          p_overbooking_override_reason?: string
          p_start_at: string
        }
        Returns: string
      }
      reschedule_customer_booking: {
        Args: { p_booking_id: string; p_start_at: string }
        Returns: Json
      }
      reschedule_public_booking_by_manage_token: {
        Args: { p_start_at: string; raw_token: string }
        Returns: Json
      }
      resend_staff_connection_invite: {
        Args: {
          p_expires_at: string
          p_request_id: string
          p_token_hash: string
        }
        Returns: Json
      }
      review_staff_salon_application: {
        Args: {
          p_decision: string
          p_display_name?: string
          p_email?: string
          p_job_title?: string
          p_phone?: string
          p_request_id: string
          p_staff_id?: string
        }
        Returns: Json
      }
      revoke_staff_connection_invite: {
        Args: { p_request_id: string }
        Returns: Json
      }
      salon_profile_public_salon_exists: {
        Args: { target_salon_id: string }
        Returns: boolean
      }
      save_salon_profile_content_booking_config: {
        Args: {
          p_additional_service_ids?: string[]
          p_booking_cta_enabled?: boolean
          p_booking_note?: string
          p_content_id: string
          p_credited_staff_id?: string
          p_primary_service_id?: string
          p_source_type: string
        }
        Returns: string
      }
      save_service_config_batch: {
        Args: { p_configs: Json; p_salon_id: string }
        Returns: Json
      }
      save_staff_weekly_availability: {
        Args: { p_rules: Json; p_salon_id: string; p_staff_id: string }
        Returns: undefined
      }
      search_pos_live_draft_customers_by_phone: {
        Args: { p_phone: string; p_token: string }
        Returns: Json
      }
      search_pos_portable_customers: {
        Args: {
          p_key_id: string
          p_search: string
          p_session_signature: string
        }
        Returns: Json
      }
      resolve_public_booking_request_notifications: {
        Args: { target_booking_id: string }
        Returns: Json
      }
      search_public_explore_salons: {
        Args: {
          p_category?: string
          p_latitude?: number
          p_location?: string
          p_longitude?: number
          p_page?: number
          p_page_size?: number
          p_query?: string
        }
        Returns: {
          active_service_count: number
          address_line1: string
          address_line2: string
          best_match_count: number
          city: string
          country: string
          cover_image_path: string
          description: string
          distance_miles: number
          featured_service_category: string
          featured_service_name: string
          group_total_count: number
          has_public_profile: boolean
          is_new: boolean
          latest_media_created_at: string
          latitude: number
          longitude: number
          match_tier: number
          match_type: string
          nearby_count: number
          phone: string
          postal_code: string
          profile_completeness: number
          recommended_count: number
          relevance_score: number
          result_group: string
          salon_id: string
          salon_name: string
          service_categories: string[]
          service_names: string[]
          starting_price: number
          state: string
          total_count: number
        }[]
      }
      search_public_staff_application_salons: {
        Args: {
          p_city?: string
          p_limit?: number
          p_query?: string
          p_state?: string
        }
        Returns: {
          address_line1: string
          address_line2: string
          city: string
          country: string
          postal_code: string
          salon_id: string
          salon_name: string
          state: string
        }[]
      }
      search_staff_connection_account_exact: {
        Args: {
          p_email: string
          p_phone: string
          target_account_id: string
          target_salon_id: string
        }
        Returns: {
          account_user_id: string
          avatar_url: string
          display_name: string
          masked_email: string
          masked_phone: string
          match_type: string
        }[]
      }
      seed_default_roles_for_account: {
        Args: { target_account_id: string }
        Returns: undefined
      }
      set_own_staff_online_booking: {
        Args: { p_online_booking_enabled: boolean; p_salon_id: string }
        Returns: Json
      }
      increment_staff_queue_turns: {
        Args: {
          p_delta: number
          p_salon_id: string
          p_staff_id: string
          p_work_date: string
        }
        Returns: number
      }
      sign_in_pos_portable_access: {
        Args: { p_access_id: string; p_passcode: string; p_user_agent?: string }
        Returns: Json
      }
      start_assigned_booking_line: {
        Args: { p_booking_line_id: string; p_service_note?: string }
        Returns: Json
      }
      submit_pos_portable_receipt: {
        Args: {
          p_key_id: string
          p_receipt: Json
          p_session_signature: string
          p_work_date?: string
        }
        Returns: Json
      }
      submit_pos_portable_attendance_event: {
        Args: {
          p_event_type: string
          p_key_id: string
          p_passcode: string
          p_session_signature: string
          p_staff_id: string
        }
        Returns: Json
      }
      submit_staff_salon_application: {
        Args: {
          p_message?: string
          p_requested_job_title?: string
          p_salon_id: string
        }
        Returns: Json
      }
      touch_pos_live_draft_activity: {
        Args: { p_reset_seconds?: number; p_token: string }
        Returns: Json
      }
      validate_staff_passcode_or_raise: {
        Args: {
          p_passcode: string
          p_salon_id: string
          p_scope: string
          p_staff_id: string
        }
        Returns: boolean
      }
      update_closed_pos_ticket_tip_for_correction: {
        Args: { p_ticket_id: string; p_tip_type: string; p_tip_value: number }
        Returns: {
          closed_at: string | null
          created_at: string
          customer_id: string | null
          discount_type: string
          discount_value: number
          id: string
          notes: string | null
          opened_at: string
          salon_id: string
          source_booking_id: string | null
          status: string
          tax_rate: number
          ticket_number: string
          ticket_sequence: number
          tip_type: string
          tip_value: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "pos_tickets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_pos_desk_session_customer_by_token: {
        Args: { p_customer_lookup: string; p_token: string }
        Returns: Json
      }
      update_pos_desk_session_tip_by_token: {
        Args: { p_confirm?: boolean; p_tip_amount: number; p_token: string }
        Returns: Json
      }
      update_pos_portable_live_draft: {
        Args: {
          p_discount?: number
          p_key_id: string
          p_selected_staff_id: string
          p_session_signature: string
          p_staff_lines: Json
          p_subtotal: number
          p_tax?: number
          p_tip: number
          p_token: string
          p_total: number
          p_total_before_tip?: number
        }
        Returns: Json
      }
      update_pos_portable_live_draft_customer: {
        Args: {
          p_customer: Json
          p_key_id: string
          p_session_signature: string
          p_token: string
        }
        Returns: Json
      }
      update_staff_public_team_batch: {
        Args: {
          changes: Json
          target_account_id: string
          target_salon_id: string
        }
        Returns: number
      }
      upsert_pos_live_draft_customer_by_phone: {
        Args: { p_phone: string; p_token: string }
        Returns: Json
      }
      user_belongs_to_account: {
        Args: { target_account_id: string }
        Returns: boolean
      }
      user_can_manage_salon: {
        Args: { target_salon_id: string }
        Returns: boolean
      }
      user_can_manage_salon_profile_media: {
        Args: { object_name: string; permission_codes: string[] }
        Returns: boolean
      }
      user_can_read_staff_scoped_row: {
        Args: { target_salon_id: string; target_staff_id: string }
        Returns: boolean
      }
      user_has_account_permission: {
        Args: { permission_codes: string[]; target_account_id: string }
        Returns: boolean
      }
      user_has_salon_permission: {
        Args: { permission_codes: string[]; target_salon_id: string }
        Returns: boolean
      }
      user_is_salon_member: {
        Args: { target_salon_id: string }
        Returns: boolean
      }
      verify_staff_connection_invite_email: {
        Args: { p_email: string; p_token: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
