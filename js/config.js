/*
 * Verbindung zu Supabase. Der anon-Key ist dafür gedacht, öffentlich im
 * Browser zu stehen – geschützt werden die Daten durch Row Level Security
 * (siehe supabase/schema.sql). Den service_role-Key niemals hier eintragen!
 */
window.ERLEDIGUNGEN_CONFIG = {
  supabaseUrl: 'https://vlxdibimxcanslopjxtx.supabase.co',
  supabaseAnonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZseGRpYmlteGNhbnNsb3BqeHR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2NzAxOTcsImV4cCI6MjEwODI0NjE5N30.ybPXM-SOWPzJ9wrrjf1x4SB7Ph1_CPsEi2nrTJy3eEo',
};
