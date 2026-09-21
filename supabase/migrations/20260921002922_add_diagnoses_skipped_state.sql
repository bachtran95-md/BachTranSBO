-- Persist explicit NONE state for Diagnózisok.

alter table public.cases
  add column if not exists diagnoses_skipped boolean not null default false;

CREATE OR REPLACE FUNCTION public.finalize_case_atomic(p_owner_id uuid, p_case jsonb, p_tests jsonb, p_summary jsonb, p_revision jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_case_id uuid := (p_case->>'id')::uuid;
  v_shift_id uuid := (p_case->>'shift_id')::uuid;
  v_test jsonb;
  v_current_test_ids uuid[] := array[]::uuid[];
  v_revision_id uuid;
  v_finalized_at timestamptz := (p_revision->>'finalized_at')::timestamptz;
  v_model text;
  v_skill_version text;
begin
  if p_owner_id is null or v_case_id is null or v_shift_id is null then
    raise exception 'Missing owner, case, or shift identifier.';
  end if;

  if coalesce(p_case->>'owner_id', '') <> p_owner_id::text then
    raise exception 'Case owner mismatch.';
  end if;

  if not exists (
    select 1 from public.shifts s
    where s.id = v_shift_id and s.owner_id = p_owner_id
  ) then
    raise exception 'Shift does not belong to authenticated user.';
  end if;

  if exists (
    select 1 from public.cases c
    where c.id = v_case_id and c.owner_id <> p_owner_id
  ) then
    raise exception 'Case belongs to another owner.';
  end if;

  insert into public.cases (
    id, shift_id, owner_id, local_id, sex, year_of_birth, main_complaint,
    arrival_mode, arrival_other,
    complaint, complaint_skipped,
    history, history_skipped,
    physical_exam, physical_exam_skipped,
    diagnoses, diagnoses_skipped,
    others,
    therapy, therapy_skipped,
    clinical_course, clinical_course_skipped,
    disposition, recommendations, hospital, ward, accepting_physician,
    admission_note, other_outcome, other_details, status, completed_at,
    created_at, updated_at, deidentified_at, deidentification_version
  )
  values (
    v_case_id, v_shift_id, p_owner_id,
    coalesce(p_case->>'local_id', ''),
    nullif(p_case->>'sex', ''),
    (p_case->>'year_of_birth')::integer,
    coalesce(p_case->>'main_complaint', ''),
    coalesce(p_case->>'arrival_mode', ''),
    coalesce(p_case->>'arrival_other', ''),
    coalesce(p_case->>'complaint', ''),
    coalesce((p_case->>'complaint_skipped')::boolean, false),
    coalesce(p_case->>'history', ''),
    coalesce((p_case->>'history_skipped')::boolean, false),
    coalesce(p_case->>'physical_exam', ''),
    coalesce((p_case->>'physical_exam_skipped')::boolean, false),
    coalesce(p_case->>'diagnoses', ''),
    coalesce((p_case->>'diagnoses_skipped')::boolean, false),
    coalesce(p_case->>'others', ''),
    coalesce(p_case->>'therapy', ''),
    coalesce((p_case->>'therapy_skipped')::boolean, false),
    coalesce(p_case->>'clinical_course', ''),
    coalesce((p_case->>'clinical_course_skipped')::boolean, false),
    coalesce(p_case->>'disposition', ''),
    coalesce(p_case->'recommendations', '[""]'::jsonb),
    coalesce(p_case->>'hospital', ''),
    coalesce(p_case->>'ward', ''),
    coalesce(p_case->>'accepting_physician', ''),
    coalesce(p_case->>'admission_note', ''),
    coalesce(p_case->>'other_outcome', ''),
    coalesce(p_case->>'other_details', ''),
    'completed',
    (p_case->>'completed_at')::timestamptz,
    coalesce((p_case->>'created_at')::timestamptz, now()),
    coalesce((p_case->>'updated_at')::timestamptz, now()),
    coalesce((p_case->>'deidentified_at')::timestamptz, now()),
    coalesce(p_case->>'deidentification_version', 'v1')
  )
  on conflict (id) do update set
    shift_id = excluded.shift_id,
    local_id = excluded.local_id,
    sex = excluded.sex,
    year_of_birth = excluded.year_of_birth,
    main_complaint = excluded.main_complaint,
    arrival_mode = excluded.arrival_mode,
    arrival_other = excluded.arrival_other,
    complaint = excluded.complaint,
    complaint_skipped = excluded.complaint_skipped,
    history = excluded.history,
    history_skipped = excluded.history_skipped,
    physical_exam = excluded.physical_exam,
    physical_exam_skipped = excluded.physical_exam_skipped,
    diagnoses = excluded.diagnoses,
    diagnoses_skipped = excluded.diagnoses_skipped,
    others = excluded.others,
    therapy = excluded.therapy,
    therapy_skipped = excluded.therapy_skipped,
    clinical_course = excluded.clinical_course,
    clinical_course_skipped = excluded.clinical_course_skipped,
    disposition = excluded.disposition,
    recommendations = excluded.recommendations,
    hospital = excluded.hospital,
    ward = excluded.ward,
    accepting_physician = excluded.accepting_physician,
    admission_note = excluded.admission_note,
    other_outcome = excluded.other_outcome,
    other_details = excluded.other_details,
    status = 'completed',
    completed_at = excluded.completed_at,
    updated_at = excluded.updated_at,
    deidentified_at = excluded.deidentified_at,
    deidentification_version = excluded.deidentification_version;

  for v_test in
    select value from jsonb_array_elements(coalesce(p_tests, '[]'::jsonb))
  loop
    if coalesce(v_test->>'owner_id', '') <> p_owner_id::text
      or coalesce(v_test->>'case_id', '') <> v_case_id::text then
      raise exception 'Test owner/case mismatch.';
    end if;

    v_current_test_ids := array_append(v_current_test_ids, (v_test->>'id')::uuid);

    insert into public.test_entries (
      id, case_id, owner_id, category, sequence, subtype, body_part, modality,
      other_test, mode, result_text, saved_result_text, updated_at
    )
    values (
      (v_test->>'id')::uuid, v_case_id, p_owner_id, v_test->>'category',
      coalesce((v_test->>'sequence')::integer, 1),
      coalesce(v_test->>'subtype', ''),
      coalesce(v_test->>'body_part', ''),
      coalesce(v_test->>'modality', ''),
      coalesce(v_test->>'other_test', ''),
      coalesce(v_test->>'mode', 'waiting'),
      coalesce(v_test->>'result_text', ''),
      coalesce(v_test->>'saved_result_text', ''),
      coalesce((v_test->>'updated_at')::timestamptz, now())
    )
    on conflict (id) do update set
      case_id = excluded.case_id,
      category = excluded.category,
      sequence = excluded.sequence,
      subtype = excluded.subtype,
      body_part = excluded.body_part,
      modality = excluded.modality,
      other_test = excluded.other_test,
      mode = excluded.mode,
      result_text = excluded.result_text,
      saved_result_text = excluded.saved_result_text,
      updated_at = excluded.updated_at;
  end loop;

  delete from public.test_entries t
  where t.case_id = v_case_id
    and t.owner_id = p_owner_id
    and not (t.id = any(v_current_test_ids));

  insert into public.summaries (
    case_id, owner_id, generated_text, working_text, finalized_text,
    generated_at, finalized_at, updated_at
  )
  values (
    v_case_id, p_owner_id,
    coalesce(p_summary->>'generated_text', ''),
    coalesce(p_summary->>'working_text', ''),
    coalesce(p_summary->>'finalized_text', ''),
    (p_summary->>'generated_at')::timestamptz,
    (p_summary->>'finalized_at')::timestamptz,
    coalesce((p_summary->>'updated_at')::timestamptz, now())
  )
  on conflict (case_id) do update set
    generated_text = excluded.generated_text,
    working_text = excluded.working_text,
    finalized_text = excluded.finalized_text,
    generated_at = excluded.generated_at,
    finalized_at = excluded.finalized_at,
    updated_at = excluded.updated_at;

  select s.model, s.skill_version into v_model, v_skill_version
  from public.summaries s
  where s.case_id = v_case_id and s.owner_id = p_owner_id;

  select r.id into v_revision_id
  from public.summary_revisions r
  where r.case_id = v_case_id
    and r.owner_id = p_owner_id
    and r.finalized_at = v_finalized_at
  order by r.created_at desc
  limit 1;

  if v_revision_id is null then
    insert into public.summary_revisions (
      case_id, owner_id, generated_text, finalized_text, finalized_at,
      model, skill_version, deidentification_version, case_snapshot
    )
    values (
      v_case_id, p_owner_id,
      coalesce(p_revision->>'generated_text', ''),
      coalesce(p_revision->>'finalized_text', ''),
      v_finalized_at, v_model, v_skill_version,
      coalesce(p_revision->>'deidentification_version', 'v1'),
      coalesce(p_revision->'case_snapshot', '{}'::jsonb)
    )
    returning id into v_revision_id;
  end if;

  return v_revision_id;
end;
$function$


revoke all on function public.finalize_case_atomic(uuid,jsonb,jsonb,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.finalize_case_atomic(uuid,jsonb,jsonb,jsonb,jsonb)
  to service_role;
