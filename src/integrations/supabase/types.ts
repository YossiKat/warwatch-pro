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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      conflict_events: {
        Row: {
          actor1: string | null
          actor2: string | null
          country: string | null
          created_at: string
          event_date: string
          event_subtype: string | null
          event_type: string
          external_id: string | null
          fatalities: number
          id: string
          lat: number | null
          location: string | null
          lon: number | null
          notes: string | null
          raw_data: Json
          region: string | null
          severity: string
          source: string
          zone_id: string | null
          zone_slug: string | null
        }
        Insert: {
          actor1?: string | null
          actor2?: string | null
          country?: string | null
          created_at?: string
          event_date?: string
          event_subtype?: string | null
          event_type?: string
          external_id?: string | null
          fatalities?: number
          id?: string
          lat?: number | null
          location?: string | null
          lon?: number | null
          notes?: string | null
          raw_data?: Json
          region?: string | null
          severity?: string
          source?: string
          zone_id?: string | null
          zone_slug?: string | null
        }
        Update: {
          actor1?: string | null
          actor2?: string | null
          country?: string | null
          created_at?: string
          event_date?: string
          event_subtype?: string | null
          event_type?: string
          external_id?: string | null
          fatalities?: number
          id?: string
          lat?: number | null
          location?: string | null
          lon?: number | null
          notes?: string | null
          raw_data?: Json
          region?: string | null
          severity?: string
          source?: string
          zone_id?: string | null
          zone_slug?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conflict_events_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "war_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      countries: {
        Row: {
          aviation_status: Database["public"]["Enums"]["infra_status"]
          center_lat: number | null
          center_lon: number | null
          civil_unrest_score: number
          created_at: string
          currency: string | null
          economic_score: number
          electricity_status: Database["public"]["Enums"]["infra_status"]
          flag_emoji: string | null
          fuel_status: Database["public"]["Enums"]["infra_status"]
          id: string
          infrastructure_score: number
          iso_code: string
          military_score: number
          name: string
          name_ar: string | null
          name_he: string | null
          political_score: number
          population: number | null
          ports_status: Database["public"]["Enums"]["infra_status"]
          region: string
          risk_score: number
          roads_status: Database["public"]["Enums"]["infra_status"]
          sentiment_score: number | null
          telecom_status: Database["public"]["Enums"]["infra_status"]
          updated_at: string
          water_status: Database["public"]["Enums"]["infra_status"]
        }
        Insert: {
          aviation_status?: Database["public"]["Enums"]["infra_status"]
          center_lat?: number | null
          center_lon?: number | null
          civil_unrest_score?: number
          created_at?: string
          currency?: string | null
          economic_score?: number
          electricity_status?: Database["public"]["Enums"]["infra_status"]
          flag_emoji?: string | null
          fuel_status?: Database["public"]["Enums"]["infra_status"]
          id?: string
          infrastructure_score?: number
          iso_code: string
          military_score?: number
          name: string
          name_ar?: string | null
          name_he?: string | null
          political_score?: number
          population?: number | null
          ports_status?: Database["public"]["Enums"]["infra_status"]
          region?: string
          risk_score?: number
          roads_status?: Database["public"]["Enums"]["infra_status"]
          sentiment_score?: number | null
          telecom_status?: Database["public"]["Enums"]["infra_status"]
          updated_at?: string
          water_status?: Database["public"]["Enums"]["infra_status"]
        }
        Update: {
          aviation_status?: Database["public"]["Enums"]["infra_status"]
          center_lat?: number | null
          center_lon?: number | null
          civil_unrest_score?: number
          created_at?: string
          currency?: string | null
          economic_score?: number
          electricity_status?: Database["public"]["Enums"]["infra_status"]
          flag_emoji?: string | null
          fuel_status?: Database["public"]["Enums"]["infra_status"]
          id?: string
          infrastructure_score?: number
          iso_code?: string
          military_score?: number
          name?: string
          name_ar?: string | null
          name_he?: string | null
          political_score?: number
          population?: number | null
          ports_status?: Database["public"]["Enums"]["infra_status"]
          region?: string
          risk_score?: number
          roads_status?: Database["public"]["Enums"]["infra_status"]
          sentiment_score?: number | null
          telecom_status?: Database["public"]["Enums"]["infra_status"]
          updated_at?: string
          water_status?: Database["public"]["Enums"]["infra_status"]
        }
        Relationships: []
      }
      daily_intel_reports: {
        Row: {
          created_at: string
          fronts: Json
          id: string
          key_findings: string[]
          raw_data: Json
          recommendations: string[]
          report_date: string
          source_stats: Json
          summary: string
          threat_level: number
        }
        Insert: {
          created_at?: string
          fronts?: Json
          id?: string
          key_findings?: string[]
          raw_data?: Json
          recommendations?: string[]
          report_date: string
          source_stats?: Json
          summary: string
          threat_level?: number
        }
        Update: {
          created_at?: string
          fronts?: Json
          id?: string
          key_findings?: string[]
          raw_data?: Json
          recommendations?: string[]
          report_date?: string
          source_stats?: Json
          summary?: string
          threat_level?: number
        }
        Relationships: []
      }
      emergency_events: {
        Row: {
          color: string
          created_at: string
          description: string | null
          event_time: string | null
          id: string
          lat: number | null
          location: string | null
          lon: number | null
          raw_data: Json
          score: number
          source: string
          title: string
        }
        Insert: {
          color?: string
          created_at?: string
          description?: string | null
          event_time?: string | null
          id?: string
          lat?: number | null
          location?: string | null
          lon?: number | null
          raw_data?: Json
          score?: number
          source?: string
          title: string
        }
        Update: {
          color?: string
          created_at?: string
          description?: string | null
          event_time?: string | null
          id?: string
          lat?: number | null
          location?: string | null
          lon?: number | null
          raw_data?: Json
          score?: number
          source?: string
          title?: string
        }
        Relationships: []
      }
      global_alerts: {
        Row: {
          acknowledged_by: string | null
          category: Database["public"]["Enums"]["alert_category"]
          country_id: string | null
          country_iso: string | null
          created_at: string
          description: string | null
          id: string
          lat: number | null
          location: string | null
          lon: number | null
          priority: Database["public"]["Enums"]["alert_priority"]
          raw_data: Json
          resolved_at: string | null
          source: string
          status: Database["public"]["Enums"]["alert_status"]
          title: string
          updated_at: string
        }
        Insert: {
          acknowledged_by?: string | null
          category?: Database["public"]["Enums"]["alert_category"]
          country_id?: string | null
          country_iso?: string | null
          created_at?: string
          description?: string | null
          id?: string
          lat?: number | null
          location?: string | null
          lon?: number | null
          priority?: Database["public"]["Enums"]["alert_priority"]
          raw_data?: Json
          resolved_at?: string | null
          source?: string
          status?: Database["public"]["Enums"]["alert_status"]
          title: string
          updated_at?: string
        }
        Update: {
          acknowledged_by?: string | null
          category?: Database["public"]["Enums"]["alert_category"]
          country_id?: string | null
          country_iso?: string | null
          created_at?: string
          description?: string | null
          id?: string
          lat?: number | null
          location?: string | null
          lon?: number | null
          priority?: Database["public"]["Enums"]["alert_priority"]
          raw_data?: Json
          resolved_at?: string | null
          source?: string
          status?: Database["public"]["Enums"]["alert_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "global_alerts_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["id"]
          },
        ]
      }
      intel_reports: {
        Row: {
          category: string
          created_at: string
          id: string
          raw_data: Json
          region: string | null
          severity: string
          source: string
          summary: string
          tags: string[]
          title: string
        }
        Insert: {
          category?: string
          created_at?: string
          id?: string
          raw_data?: Json
          region?: string | null
          severity?: string
          source?: string
          summary: string
          tags?: string[]
          title: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          raw_data?: Json
          region?: string | null
          severity?: string
          source?: string
          summary?: string
          tags?: string[]
          title?: string
        }
        Relationships: []
      }
      oref_alerts: {
        Row: {
          alert_date: string
          category: number
          created_at: string
          description: string | null
          id: string
          locations: string[]
          raw_data: Json
          title: string
        }
        Insert: {
          alert_date: string
          category?: number
          created_at?: string
          description?: string | null
          id?: string
          locations?: string[]
          raw_data: Json
          title: string
        }
        Update: {
          alert_date?: string
          category?: number
          created_at?: string
          description?: string | null
          id?: string
          locations?: string[]
          raw_data?: Json
          title?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          credits: number | null
          display_name: string | null
          email: string | null
          id: string
          last_login: string | null
          location_consent: boolean | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          credits?: number | null
          display_name?: string | null
          email?: string | null
          id?: string
          last_login?: string | null
          location_consent?: boolean | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          credits?: number | null
          display_name?: string | null
          email?: string | null
          id?: string
          last_login?: string | null
          location_consent?: boolean | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_agent: string | null
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_agent?: string | null
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      sentiment_scores: {
        Row: {
          analysis_window: string
          created_at: string
          data_points: number
          id: string
          label: string
          raw_data: Json
          score: number
          sources: string[]
          top_headlines: string[]
        }
        Insert: {
          analysis_window?: string
          created_at?: string
          data_points?: number
          id?: string
          label?: string
          raw_data?: Json
          score?: number
          sources?: string[]
          top_headlines?: string[]
        }
        Update: {
          analysis_window?: string
          created_at?: string
          data_points?: number
          id?: string
          label?: string
          raw_data?: Json
          score?: number
          sources?: string[]
          top_headlines?: string[]
        }
        Relationships: []
      }
      telegram_bot_state: {
        Row: {
          bot_name: string
          id: number
          update_offset: number
          updated_at: string
        }
        Insert: {
          bot_name?: string
          id: number
          update_offset?: number
          updated_at?: string
        }
        Update: {
          bot_name?: string
          id?: number
          update_offset?: number
          updated_at?: string
        }
        Relationships: []
      }
      telegram_groups: {
        Row: {
          chat_id: number
          created_at: string
          id: string
          last_message_at: string | null
          message_count: number
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          chat_id: number
          created_at?: string
          id?: string
          last_message_at?: string | null
          message_count?: number
          title: string
          type?: string
          updated_at?: string
        }
        Update: {
          chat_id?: number
          created_at?: string
          id?: string
          last_message_at?: string | null
          message_count?: number
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      telegram_messages: {
        Row: {
          bot_name: string
          chat_id: number
          content_hash: string | null
          created_at: string
          duplicate_of: string | null
          id: string
          is_duplicate: boolean
          message_date: string | null
          message_id: number | null
          raw_update: Json
          sender_name: string | null
          severity: string | null
          tags: string[] | null
          text: string | null
          update_id: number
        }
        Insert: {
          bot_name?: string
          chat_id: number
          content_hash?: string | null
          created_at?: string
          duplicate_of?: string | null
          id?: string
          is_duplicate?: boolean
          message_date?: string | null
          message_id?: number | null
          raw_update: Json
          sender_name?: string | null
          severity?: string | null
          tags?: string[] | null
          text?: string | null
          update_id: number
        }
        Update: {
          bot_name?: string
          chat_id?: number
          content_hash?: string | null
          created_at?: string
          duplicate_of?: string | null
          id?: string
          is_duplicate?: boolean
          message_date?: string | null
          message_id?: number | null
          raw_update?: Json
          sender_name?: string | null
          severity?: string | null
          tags?: string[] | null
          text?: string | null
          update_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "telegram_messages_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "telegram_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      user_activity_log: {
        Row: {
          action: string
          created_at: string
          id: string
          metadata: Json | null
          page: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          metadata?: Json | null
          page?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          page?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      war_zones: {
        Row: {
          bbox_max_lat: number | null
          bbox_max_lon: number | null
          bbox_min_lat: number | null
          bbox_min_lon: number | null
          center_lat: number
          center_lon: number
          countries: string[]
          created_at: string
          events_30d: number
          fatalities_30d: number
          id: string
          intensity: number
          name: string
          name_he: string | null
          raw_data: Json
          region: string
          slug: string
          status: string
          summary: string | null
          summary_he: string | null
          updated_at: string
        }
        Insert: {
          bbox_max_lat?: number | null
          bbox_max_lon?: number | null
          bbox_min_lat?: number | null
          bbox_min_lon?: number | null
          center_lat: number
          center_lon: number
          countries?: string[]
          created_at?: string
          events_30d?: number
          fatalities_30d?: number
          id?: string
          intensity?: number
          name: string
          name_he?: string | null
          raw_data?: Json
          region?: string
          slug: string
          status?: string
          summary?: string | null
          summary_he?: string | null
          updated_at?: string
        }
        Update: {
          bbox_max_lat?: number | null
          bbox_max_lon?: number | null
          bbox_min_lat?: number | null
          bbox_min_lon?: number | null
          center_lat?: number
          center_lon?: number
          countries?: string[]
          created_at?: string
          events_30d?: number
          fatalities_30d?: number
          id?: string
          intensity?: number
          name?: string
          name_he?: string | null
          raw_data?: Json
          region?: string
          slug?: string
          status?: string
          summary?: string | null
          summary_he?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_old_activity: { Args: never; Returns: undefined }
      cleanup_old_data: { Args: never; Returns: undefined }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      alert_category:
        | "geo_political"
        | "natural_disaster"
        | "water_crisis"
        | "civil_unrest"
        | "infrastructure"
        | "drone_anomaly"
        | "network_overload"
      alert_priority: "P1" | "P2" | "P3"
      alert_status: "active" | "acknowledged" | "resolved"
      app_role: "admin" | "user"
      infra_status: "normal" | "elevated" | "critical" | "emergency"
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
    Enums: {
      alert_category: [
        "geo_political",
        "natural_disaster",
        "water_crisis",
        "civil_unrest",
        "infrastructure",
        "drone_anomaly",
        "network_overload",
      ],
      alert_priority: ["P1", "P2", "P3"],
      alert_status: ["active", "acknowledged", "resolved"],
      app_role: ["admin", "user"],
      infra_status: ["normal", "elevated", "critical", "emergency"],
    },
  },
} as const
