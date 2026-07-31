-- Dienstruil zonder tegenprestatie.
--
-- Tot nu was elke ruil 1-op-1: de aanvrager gaf een dienst en nam er iets
-- van de collega voor terug (return_date + return_code). Daar komt een
-- tweede vorm bij: 'overname' — de collega neemt de dienst over zonder dat
-- de aanvrager er iets voor teruggeeft. return_date/return_code blijven dan
-- leeg.
--
-- Bestaande rijen zijn per definitie 1-op-1 → default 'ruil'.
-- Idempotent; plak in de Supabase SQL Editor en draai één keer.

alter table public.swaps
  add column if not exists swap_type text not null default 'ruil';

-- Alleen de twee bekende vormen. Een tikfout in de API zou anders stil als
-- 1-op-1-ruil doorgaan (de UI valt terug op 'ruil' bij een onbekende waarde).
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.swaps'::regclass
      and conname = 'swaps_swap_type_check'
  ) then
    alter table public.swaps
      add constraint swaps_swap_type_check
      check (swap_type in ('ruil', 'overname'));
  end if;
end
$$;
