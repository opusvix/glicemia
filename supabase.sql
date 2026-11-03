-- Glicemia: tabela única por usuário, com os dados do app num campo JSON.
-- Cole este bloco inteiro no Supabase: menu "SQL Editor" -> "New query" -> colar -> "Run".
-- Pode rodar de novo sem problema (tudo é "if not exists" / "or replace").

create table if not exists public.glicemia (
  user_id       uuid        primary key references auth.users (id) on delete cascade,
  dados         jsonb       not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);

alter table public.glicemia enable row level security;

-- Cada pessoa só enxerga e só mexe na própria linha.
drop policy if exists "dono le"      on public.glicemia;
drop policy if exists "dono insere"  on public.glicemia;
drop policy if exists "dono atualiza" on public.glicemia;
drop policy if exists "dono apaga"   on public.glicemia;

create policy "dono le"       on public.glicemia for select using (auth.uid() = user_id);
create policy "dono insere"   on public.glicemia for insert with check (auth.uid() = user_id);
create policy "dono atualiza" on public.glicemia for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "dono apaga"    on public.glicemia for delete using (auth.uid() = user_id);
