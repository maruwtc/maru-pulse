-- Allow the home-page AI market brief in the AI audit log.
alter table public.ai_generations drop constraint ai_generations_kind_check;
alter table public.ai_generations add constraint ai_generations_kind_check
  check (kind in ('analysis', 'trade_ideas', 'position_review', 'market_brief'));
