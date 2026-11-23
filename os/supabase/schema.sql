-- Esquema do servidor das OS no Supabase. Rodar uma vez no SQL Editor do projeto.
--
-- A OS vai inteira como JSON (`dados`): o motor de etapas e o mesmo no app e
-- aqui não há regra para duplicar. Colunas de consulta podem ser extraídas
-- depois com colunas geradas, sem migrar o app.

create table if not exists public.ordens (
  id uuid primary key,
  dados jsonb not null,
  atualizada_em timestamptz not null,
  autor uuid not null default auth.uid() references auth.users (id)
);

alter table public.ordens enable row level security;

-- Só usuário logado (você e os técnicos que você cadastrar em Authentication)
-- lê e grava. A chave anon sozinha não acessa nada.
create policy "logado le" on public.ordens for select to authenticated using (true);
create policy "logado grava" on public.ordens for insert to authenticated with check (autor = auth.uid());
create policy "autor atualiza" on public.ordens for update to authenticated using (autor = auth.uid());

-- Fotos: bucket privado.
insert into storage.buckets (id, name, public) values ('fotos', 'fotos', false)
on conflict (id) do nothing;

create policy "logado envia foto" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos');
create policy "logado atualiza foto" on storage.objects for update to authenticated
  using (bucket_id = 'fotos');
create policy "logado le foto" on storage.objects for select to authenticated
  using (bucket_id = 'fotos');
