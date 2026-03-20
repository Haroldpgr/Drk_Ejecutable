import { createClient } from '@supabase/supabase-js'

// Sustituye estos valores con los de tu proyecto de Supabase (https://supabase.com/)
const supabaseUrl = 'https://uemqmgymyjcfugpomfps.supabase.co'
const supabaseAnonKey = 'sb_publishable_7eDQXWKj21OjonbH1vsdOQ_L3Ooo5yC'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
