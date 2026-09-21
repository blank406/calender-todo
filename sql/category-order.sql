-- Run in Supabase SQL Editor BEFORE deploying the updated app.
begin;
alter table public.categories add column if not exists sort_order integer;

-- First run: per-user created_at ASC, id ASC -> 0, 1, 2, ... .
-- Re-runs preserve valid saved orders; only incomplete/duplicate orders are repaired.
with invalid_users as (
    select user_id from public.categories group by user_id
    having count(sort_order) <> count(*) or count(distinct sort_order) <> count(*)
), ranked as (
    select id, (row_number() over (
        partition by user_id order by sort_order asc nulls last, created_at asc, id asc
    ) - 1)::integer as position
    from public.categories where user_id in (select user_id from invalid_users)
)
update public.categories c set sort_order = r.position from ranked r where c.id = r.id;

-- Invoker functions retain existing table permissions and RLS.
-- Serialize inserts/swaps for one user, including when they have no categories.
create or replace function public.prepare_category_order()
returns void language plpgsql security invoker set search_path = '' as $$
begin
    if auth.uid() is null then raise exception 'Authentication required'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text, 731));
    perform id from public.categories where user_id = auth.uid() order by id for update;
    if exists (
        select 1 from public.categories where user_id = auth.uid()
        having count(sort_order) <> count(*) or count(distinct sort_order) <> count(*)
    ) then
        with ranked as (
            select id, (row_number() over (
                order by sort_order asc nulls last, created_at asc, id asc
            ) - 1)::integer as position
            from public.categories where user_id = auth.uid()
        )
        update public.categories c set sort_order = r.position
        from ranked r where c.id = r.id and c.user_id = auth.uid();
    end if;
end;
$$;

-- Recalculate on the server so simultaneous inserts from two devices append safely.
create or replace function public.append_category_order()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
    if new.user_id is distinct from auth.uid() then raise exception 'Invalid category ownership'; end if;
    perform public.prepare_category_order();
    select coalesce(max(sort_order), -1) + 1 into new.sort_order
    from public.categories where user_id = auth.uid();
    return new;
end;
$$;
drop trigger if exists categories_append_order on public.categories;
create trigger categories_append_order before insert on public.categories
for each row execute function public.append_category_order();

create or replace function public.swap_category_order(first_id text, second_id text)
returns setof public.categories language plpgsql security invoker set search_path = '' as $$
declare
    first_position integer;
    second_position integer;
    changed integer;
begin
    perform public.prepare_category_order();
    select sort_order into first_position from public.categories
    where id::text = first_id and user_id = auth.uid();
    select sort_order into second_position from public.categories
    where id::text = second_id and user_id = auth.uid();
    if first_position is null or second_position is null or first_id = second_id then
        raise exception 'Invalid categories';
    end if;
    if exists (select 1 from public.categories where user_id = auth.uid()
        and sort_order > least(first_position, second_position)
        and sort_order < greatest(first_position, second_position)) then
        raise exception 'Order changed; reload categories';
    end if;
    update public.categories
    set sort_order = case when id::text = first_id then second_position else first_position end
    where user_id = auth.uid() and id::text in (first_id, second_id);
    get diagnostics changed = row_count;
    if changed <> 2 then raise exception 'Category update denied'; end if;
    return query select * from public.categories where user_id = auth.uid()
        order by sort_order asc nulls last, created_at asc, id asc;
end;
$$;

revoke all on function public.prepare_category_order() from public, anon;
revoke all on function public.append_category_order() from public, anon;
revoke all on function public.swap_category_order(text, text) from public, anon;
grant execute on function public.prepare_category_order() to authenticated;
grant execute on function public.append_category_order() to authenticated;
grant execute on function public.swap_category_order(text, text) to authenticated;
commit;
