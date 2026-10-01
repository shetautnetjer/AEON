"""Fixture-only AEON receipt validation and disposable checkpoint publication.

No dispatcher, native mutation, model, account, session or authority is exposed.
The caller supplies trusted frozen fixture policy separately from observations
and evidence. Identity bindings are checked, not authenticated. Retained bytes
follow Brainstem's selected-snapshot.v1.local contract; no dispatcher is imported.
Only a successful publication receipt acknowledges the candidate checkpoint.
"""

import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tempfile


LIMIT = 200_000
WINDOW = 80
SNAPSHOT_FORMAT = 'brainstem-selected-snapshot.v1.local'
PROJECTION_FORMAT = 'aeon.fixture-projection.v1'


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def encode(value):
    return json.dumps(value, sort_keys=True, allow_nan=False).encode('utf-8')


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate_json_member')
        result[key] = value
    return result


def decode(raw):
    def reject(_):
        raise ValueError('nonfinite_json')
    if len(raw) > LIMIT:
        raise ValueError('json_size_limit')
    return json.loads(raw, object_pairs_hook=_unique, parse_constant=reject)


def _shape(value, required, optional=()):
    if not isinstance(value, dict) or not set(required) <= set(value) <= set(required) | set(optional):
        raise ValueError('invalid_fields')


def _identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,127}', value):
        raise ValueError('invalid_identifier')


def _digest(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-f0-9]{64}', value):
        raise ValueError('invalid_digest')


def _members(value):
    if not isinstance(value, list) or len(value) > WINDOW:
        raise ValueError('invalid_members')
    for item in value:
        _identifier(item)
    if len(set(value)) != len(value):
        raise ValueError('duplicate_identifier')


def _relative(value):
    if not isinstance(value, str) or not 0 < len(value) <= 512 or '\x00' in value or '\\' in value:
        raise ValueError('invalid_relative_path')
    path = PurePosixPath(value)
    if path.is_absolute() or '..' in path.parts or path.as_posix() != value or value == '.':
        raise ValueError('invalid_relative_path')


def _checked(path):
    path = Path(path).absolute()
    if '..' in path.parts or any(p.is_symlink() for p in (path, *path.parents)):
        raise ValueError('unsafe_path')
    return path


def _temporary_directory(path):
    path = _checked(path)
    if Path('/tmp') not in path.parents or not path.is_dir() or path.stat().st_uid != os.getuid():
        raise ValueError('owned_temporary_directory_required')
    return path


def _read(path, limit=LIMIT):
    path = _checked(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError('regular_file_required')
        raw = stream.read(limit + 1)
    if len(raw) > limit:
        raise ValueError('file_size_limit')
    return raw


def validate_policy(policy):
    _shape(policy, ['format', 'task', 'criterion', 'attempts'])
    if policy['format'] != 'aeon.fixture-policy.v1':
        raise ValueError('fixture_policy_required')
    _shape(policy['task'], ['id', 'company_id', 'project_id', 'issue_id'])
    for value in policy['task'].values():
        _identifier(value)
    criterion = policy['criterion']
    _shape(criterion, ['revision', 'sha256', 'text', 'required_inputs', 'required_checks', 'obligations'])
    _identifier(criterion['revision'])
    _digest(criterion['sha256'])
    if not isinstance(criterion['text'], str) or sha256(criterion['text'].encode()) != criterion['sha256']:
        raise ValueError('criterion_digest_mismatch')
    inputs = criterion['required_inputs']
    if not isinstance(inputs, list) or not 0 < len(inputs) <= WINDOW or len(set(inputs)) != len(inputs):
        raise ValueError('invalid_required_selection')
    for value in inputs:
        _relative(value)
    for name in ['required_checks', 'obligations']:
        _members(criterion[name])
        if not criterion[name]:
            raise ValueError('empty_criterion')
    attempts = policy['attempts']
    if not isinstance(attempts, dict) or not 0 < len(attempts) <= WINDOW:
        raise ValueError('invalid_attempts')
    run_ids = []
    for attempt_id, attempt in attempts.items():
        _identifier(attempt_id)
        _shape(attempt, ['producer_id', 'producer_run_id', 'reviewer_id', 'reviewer_run_id', 'manifest_sha256'])
        for field in ['producer_id', 'producer_run_id', 'reviewer_id', 'reviewer_run_id']:
            _identifier(attempt[field])
        _digest(attempt['manifest_sha256'])
        if attempt['producer_id'] == attempt['reviewer_id'] or attempt['producer_run_id'] == attempt['reviewer_run_id']:
            raise ValueError('independent_reviewer_required')
        run_ids.extend([attempt['producer_run_id'], attempt['reviewer_run_id']])
    if len(run_ids) != len(set(run_ids)):
        raise ValueError('run_rebound_across_attempts')
    if len(encode(policy)) > LIMIT:
        raise ValueError('policy_size_limit')
    return policy


def _observation(policy, observation):
    _shape(observation, ['task_id', 'company_id', 'project_id', 'issue_id', 'attempt_id',
                        'status_version', 'status', 'assignee_id', 'checkout_run_id', 'execution_run_id',
                        'stage', 'activity', 'checkpoint', 'gate', 'producer_run', 'reviewer_run'], ['body'])
    task = policy['task']
    for field in ['company_id', 'project_id', 'issue_id']:
        if observation[field] != task[field]:
            raise ValueError('task_binding_mismatch')
    if observation['task_id'] != task['id'] or observation['attempt_id'] not in policy['attempts']:
        raise ValueError('task_attempt_mismatch')
    if type(observation['status_version']) is not int or observation['status_version'] < 0:
        raise ValueError('invalid_status_version')
    if observation['status'] not in ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled']:
        raise ValueError('invalid_status')
    _identifier(observation['stage'])
    _shape(observation['activity'], ['id', 'at'])
    _identifier(observation['activity']['id'])
    at = observation['activity']['at']
    if not isinstance(at, str) or len(at) > 100 or datetime.datetime.fromisoformat(at.replace('Z', '+00:00')).tzinfo is None:
        raise ValueError('invalid_activity_time')
    checkpoint = observation['checkpoint']
    _shape(checkpoint, ['locator', 'unfinished', 'resolved'])
    if not isinstance(checkpoint['locator'], str) or not 0 < len(checkpoint['locator']) <= 512:
        raise ValueError('invalid_checkpoint')
    for field in ['unfinished', 'resolved']:
        _members(checkpoint[field])
        if not set(checkpoint[field]) <= set(policy['criterion']['obligations']):
            raise ValueError('unknown_obligation')
    if set(checkpoint['unfinished']) & set(checkpoint['resolved']):
        raise ValueError('contradictory_checkpoint')
    if set(checkpoint['unfinished'] + checkpoint['resolved']) != set(policy['criterion']['obligations']):
        raise ValueError('missing_obligation')
    gate = observation['gate']
    if gate is not None:
        _shape(gate, ['id', 'owner', 'reason'])
        for value in gate.values():
            _identifier(value)
    if observation['status'] == 'blocked' and gate is None:
        raise ValueError('blocked_gate_required')
    if gate is not None and observation['status'] != 'blocked':
        raise ValueError('gate_cannot_be_cleared_by_observation')
    attempt = policy['attempts'][observation['attempt_id']]
    allowed = {attempt['producer_run_id']: attempt['producer_id'], attempt['reviewer_run_id']: attempt['reviewer_id']}
    if observation['assignee_id'] is not None and observation['assignee_id'] not in allowed.values():
        raise ValueError('owner_conflict')
    for field in ['checkout_run_id', 'execution_run_id']:
        run_id = observation[field]
        if run_id is not None and (run_id not in allowed or observation['assignee_id'] != allowed[run_id]):
            raise ValueError('claim_conflict')
    for field in ['producer_run', 'reviewer_run']:
        run = observation[field]
        if run is not None:
            _shape(run, ['id', 'principal_id', 'status'])
            role = field.removesuffix('_run')
            if run['id'] != attempt[role + '_run_id'] or run['principal_id'] != attempt[role + '_id']:
                raise ValueError('run_binding_mismatch')
            if run['status'] not in ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'timed_out']:
                raise ValueError('invalid_run_status')
    if len(encode(observation)) > LIMIT:
        raise ValueError('observation_size_limit')


def _snapshot(directory, required_inputs):
    # Read a retained fixture, never freeze source or call the Brainstem helper.
    directory = _temporary_directory(directory)
    raw = _read(directory / 'manifest.json')
    manifest = decode(raw)
    _shape(manifest, ['version', 'execution_id', 'files'])
    if manifest['version'] != SNAPSHOT_FORMAT or raw != encode(manifest):
        raise ValueError('invalid_snapshot_encoding')
    _identifier(manifest['execution_id'])
    files = manifest['files']
    if not isinstance(files, dict) or not 0 < len(files) <= WINDOW:
        raise ValueError('invalid_snapshot_inventory')
    if not set(required_inputs) <= set(files):
        raise ValueError('missing_required_input')
    expected_files = {'manifest.json'}
    expected_dirs = {'files'}
    total = 0
    for relative, digest in files.items():
        _relative(relative)
        _digest(digest)
        target = Path('files') / relative
        expected_files.add(target.as_posix())
        expected_dirs.update(p.as_posix() for p in target.parents if p.as_posix() != '.')
        payload = _read(directory / target, 1024 * 1024)
        total += len(payload)
        if total > 8 * 1024 * 1024:
            raise ValueError('snapshot_size_limit')
        if sha256(payload) != digest:
            raise ValueError('snapshot_content_mismatch')
    actual_files, actual_dirs = set(), set()
    for path in directory.rglob('*'):
        _checked(path)
        (actual_dirs if path.is_dir() else actual_files).add(path.relative_to(directory).as_posix())
    if actual_files != expected_files or actual_dirs != expected_dirs:
        raise ValueError('snapshot_inventory_mismatch')
    return manifest['execution_id'], sha256(raw)


def _acceptance_binding(policy, attempt_id):
    attempt = policy['attempts'][attempt_id]
    criterion = policy['criterion']
    return {'task_id': policy['task']['id'], 'attempt_id': attempt_id,
            'producer_run_id': attempt['producer_run_id'], 'criterion_revision': criterion['revision'],
            'criterion_sha256': criterion['sha256'], 'manifest_sha256': attempt['manifest_sha256'],
            'evidence_class': 'source/fake', 'reviewer_id': attempt['reviewer_id'],
            'reviewer_run_id': attempt['reviewer_run_id']}


def _receipt(policy, observation, evidence, snapshot):
    _shape(evidence, ['task_id', 'attempt_id', 'producer_run_id', 'criterion_revision', 'criterion_sha256',
                      'manifest_sha256', 'checks', 'review', 'evidence_class'], ['body'])
    attempt = policy['attempts'][observation['attempt_id']]
    criterion = policy['criterion']
    binding = _acceptance_binding(policy, observation['attempt_id'])
    expected = {k: v for k, v in binding.items() if k not in ['reviewer_id', 'reviewer_run_id']}
    if any(evidence[k] != v for k, v in expected.items()):
        raise ValueError('receipt_binding_mismatch')
    execution_id, manifest_digest = _snapshot(snapshot, criterion['required_inputs'])
    if execution_id != attempt['producer_run_id'] or manifest_digest != attempt['manifest_sha256']:
        raise ValueError('snapshot_binding_mismatch')
    for field in ['producer_run', 'reviewer_run']:
        if observation[field] is None or observation[field]['status'] != 'succeeded':
            raise ValueError('unfinished_run')
    checks = evidence['checks']
    if not isinstance(checks, dict) or set(checks) != set(criterion['required_checks']) or any(v != 'pass' for v in checks.values()):
        raise ValueError('unfinished_check')
    review = evidence['review']
    _shape(review, ['principal_id', 'run_id', 'manifest_sha256', 'verdict'], ['body'])
    if (review['principal_id'] != attempt['reviewer_id'] or review['run_id'] != attempt['reviewer_run_id']
            or review['manifest_sha256'] != manifest_digest):
        raise ValueError('review_binding_mismatch')
    if review['verdict'] not in ['accepted', 'changes_requested', 'rejected']:
        raise ValueError('unfinished_review')
    return {**binding, 'verdict': review['verdict']}


def _disposition(observation, receipt):
    status = observation['status']
    if receipt is not None:
        if receipt['verdict'] != 'accepted':
            return 'changes_requested'
        if status == 'done' and not observation['checkpoint']['unfinished']:
            return 'accepted_completion'
    return {'backlog': 'queued', 'todo': 'queued', 'in_progress': 'active', 'in_review': 'review_ready',
            'done': 'observed_done_acceptance_pending', 'blocked': 'blocked', 'cancelled': 'cancelled'}[status]


def _project(policy, observation, evidence, snapshot):
    status = observation['status']
    receipt, reason = None, 'no_acceptance_receipt'
    if evidence is not None and status not in ['blocked', 'cancelled']:
        try:
            receipt = _receipt(policy, observation, evidence, snapshot)
            reason = receipt['verdict']
        except (ValueError, OSError, TypeError) as exc:
            reason = str(exc)
    disposition = _disposition(observation, receipt)
    captured = {k: v for k, v in observation.items() if k != 'body'}
    return {'format': PROJECTION_FORMAT, 'policy_sha256': sha256(encode(policy)), 'task_id': policy['task']['id'],
            'native_observation': captured, 'native_observation_sha256': sha256(encode(captured)),
            'observation_sha256': sha256(encode(observation)), 'last_applied_activity': observation['activity']['id'],
            'evidence_sha256': sha256(encode(evidence)),
            'checkpoint': observation['checkpoint'], 'disposition': disposition,
            'accepted_completion': disposition == 'accepted_completion', 'acceptance': receipt, 'reason': reason}


def _sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _repair(path, raw):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    _sync_directory(path.parent)
    if _read(path) != raw:
        raise OSError('projection_readback_mismatch')


def _previous_projection(previous, raw, policy):
    _shape(previous, ['format', 'policy_sha256', 'task_id', 'native_observation', 'observation_sha256',
                      'native_observation_sha256',
                      'evidence_sha256', 'last_applied_activity', 'checkpoint', 'disposition',
                      'accepted_completion', 'acceptance', 'reason', 'history'])
    if (previous['format'] != PROJECTION_FORMAT or raw != encode(previous)
            or previous['policy_sha256'] != sha256(encode(policy)) or previous['task_id'] != policy['task']['id']):
        raise ValueError('projection_or_policy_changed')
    observation = previous['native_observation']
    _observation(policy, observation)
    for field in ['observation_sha256', 'native_observation_sha256', 'evidence_sha256']:
        _digest(previous[field])
    # Input bodies stay omitted; this separate checksum always reconstructs the
    # captured native fields. Older drafts without it require reconciliation.
    if previous['native_observation_sha256'] != sha256(encode(observation)):
        raise ValueError('captured_observation_digest_mismatch')
    if previous['checkpoint'] != observation['checkpoint']:
        raise ValueError('checkpoint_changed')
    receipt = previous['acceptance']
    if not isinstance(previous['reason'], str) or not previous['reason']:
        raise ValueError('invalid_stored_reason')
    if receipt is not None:
        binding = _acceptance_binding(policy, observation['attempt_id'])
        _shape(receipt, [*binding, 'verdict'])
        if any(receipt[k] != v for k, v in binding.items()) or receipt['verdict'] not in ['accepted', 'changes_requested', 'rejected']:
            raise ValueError('stored_acceptance_binding_mismatch')
        if (observation['status'] in ['blocked', 'cancelled']
                or any(observation[k] is None or observation[k]['status'] != 'succeeded'
                       for k in ['producer_run', 'reviewer_run'])):
            raise ValueError('stored_acceptance_run_mismatch')
        if previous['reason'] != receipt['verdict']:
            raise ValueError('stored_verdict_reason_mismatch')
    elif (observation['status'] in ['blocked', 'cancelled'] or previous['evidence_sha256'] == sha256(encode(None))):
        if previous['reason'] != 'no_acceptance_receipt':
            raise ValueError('stored_empty_receipt_reason_mismatch')
    disposition = _disposition(observation, receipt)
    if (previous['disposition'] != disposition or type(previous['accepted_completion']) is not bool
            or previous['accepted_completion'] != (disposition == 'accepted_completion')):
        raise ValueError('stored_completion_state_mismatch')
    history = previous['history']
    if not isinstance(history, list) or not 0 < len(history) <= WINDOW:
        raise ValueError('invalid_history')
    ids, versions = [], []
    for event in history:
        _shape(event, ['id', 'status_version', 'observation_sha256', 'evidence_sha256', 'attempt_id', 'disposition', 'manifest_sha256'])
        _identifier(event['id'])
        for field in ['observation_sha256', 'evidence_sha256']:
            _digest(event[field])
        if type(event['status_version']) is not int or event['status_version'] < 0:
            raise ValueError('invalid_history_version')
        if event['attempt_id'] not in policy['attempts']:
            raise ValueError('invalid_history_attempt')
        if event['manifest_sha256'] is not None:
            _digest(event['manifest_sha256'])
            if event['manifest_sha256'] != policy['attempts'][event['attempt_id']]['manifest_sha256']:
                raise ValueError('history_manifest_binding_mismatch')
        ids.append(event['id'])
        versions.append(event['status_version'])
    if len(set(ids)) != len(ids) or previous['last_applied_activity'] != history[-1]['id']:
        raise ValueError('invalid_history_checkpoint')
    if any(earlier >= later for earlier, later in zip(versions, versions[1:])):
        raise ValueError('nonmonotonic_history_versions')
    last = history[-1]
    expected_last = {'id': observation['activity']['id'], 'status_version': observation['status_version'],
                     'attempt_id': observation['attempt_id'], 'observation_sha256': previous['observation_sha256'],
                     'evidence_sha256': previous['evidence_sha256'], 'disposition': disposition,
                     'manifest_sha256': (receipt or {}).get('manifest_sha256')}
    if last != expected_last:
        raise ValueError('last_history_linkage_mismatch')


def apply_observation(policy, observation, *, output, expected_preimage, evidence=None, snapshot=None):
    """Validate and project one fixture observation; caller owns a /tmp parent.

    None preimage means absent. A conflict never overwrites. After an unknown
    post-replace result, explicitly read back and exact-retry with that preimage.
    Event history is bounded projection provenance, not a dispatch ledger.
    Cooperating writers hold the sidecar; this is not a filesystem CAS against
    hostile same-UID edits. Recheck the preimage immediately before replacement.
    """
    # Detach caller data so later mutation cannot rebind this invocation.
    policy, observation = decode(encode(policy)), decode(encode(observation))
    evidence = decode(encode(evidence)) if evidence is not None else None
    validate_policy(policy)
    _observation(policy, observation)
    if expected_preimage is not None:
        _digest(expected_preimage)
    output = _checked(output)
    if output.name != 'projection.json':
        raise ValueError('draft_projection_name_required')
    parent = _temporary_directory(output.parent)
    lock_fd = os.open(parent / 'projection.json.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    try:
        info = os.fstat(lock_fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid():
            raise ValueError('unsafe_lock')
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        os.fsync(lock_fd)
        _sync_directory(parent.parent)
        _sync_directory(parent)
        try:
            previous_raw = _read(output)
        except FileNotFoundError:
            previous_raw = None
        observed_preimage = sha256(previous_raw) if previous_raw is not None else None
        def result(outcome, **values):
            return {'outcome': outcome, 'expected_preimage': expected_preimage,
                    'observed_preimage': observed_preimage, 'effects': [], **values}
        if observed_preimage != expected_preimage:
            return result('sync_conflict', reason='preimage_mismatch')
        previous = None
        # Physical absence is distinct from an existing JSON null or malformed
        # payload. Validate every present payload before replay/state decisions.
        if previous_raw is not None:
            try:
                previous = decode(previous_raw)
                _previous_projection(previous, previous_raw, policy)
            except (ValueError, TypeError, KeyError) as exc:
                return result('sync_conflict', reason=str(exc))
        desired = _project(policy, observation, evidence, snapshot)
        if previous is not None:
            for event in previous['history']:
                if event['id'] == observation['activity']['id']:
                    if (event['observation_sha256'] != desired['observation_sha256']
                            or event['evidence_sha256'] != desired['evidence_sha256']):
                        return result('sync_conflict', reason='activity_rebound')
                    if (event['disposition'] != desired['disposition']
                            or event['manifest_sha256'] != (desired['acceptance'] or {}).get('manifest_sha256')):
                        return result('sync_conflict', reason='retained_receipt_changed')
                    if event['id'] == previous['last_applied_activity']:
                        retained = {k: v for k, v in previous.items() if k != 'history'}
                        if retained != desired:
                            return result('sync_conflict', reason='current_replay_projection_mismatch')
                    try:
                        _repair(output, previous_raw)
                    except OSError as exc:
                        return result('unknown_publication', reason=str(exc), projection_sha256=observed_preimage)
                    return result('replayed', projection_sha256=observed_preimage)
            prior_version = previous['native_observation']['status_version']
            if observation['status_version'] < prior_version:
                return result('stale', projection_sha256=observed_preimage)
            if observation['status_version'] == prior_version:
                return result('sync_conflict', reason='equal_version_divergence')
            if previous['disposition'] in ['blocked', 'cancelled', 'accepted_completion']:
                return result('sync_conflict', reason='terminal_or_blocked_checkpoint')
            if not set(previous['checkpoint']['unfinished']) <= set(observation['checkpoint']['unfinished'] + observation['checkpoint']['resolved']):
                return result('sync_conflict', reason='lost_unfinished_obligation')
        history = previous['history'] if previous is not None else []
        if len(history) >= WINDOW:
            return result('sync_conflict', reason='provenance_window_exhausted')
        desired['history'] = [*history, {'id': observation['activity']['id'], 'status_version': observation['status_version'],
                                      'observation_sha256': desired['observation_sha256'], 'attempt_id': observation['attempt_id'],
                                      'evidence_sha256': desired['evidence_sha256'],
                                      'disposition': desired['disposition'], 'manifest_sha256': (desired['acceptance'] or {}).get('manifest_sha256')}]
        raw = encode(desired)
        if len(raw) > LIMIT:
            raise ValueError('projection_size_limit')
        fd, draft = tempfile.mkstemp(prefix='.projection-', suffix='.tmp', dir=parent)
        replaced = False
        try:
            with os.fdopen(fd, 'wb') as stream:
                os.fchmod(stream.fileno(), 0o600)
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            try:
                latest_raw = _read(output)
            except FileNotFoundError:
                latest_raw = None
            latest_preimage = sha256(latest_raw) if latest_raw is not None else None
            if latest_preimage != expected_preimage:
                return result('sync_conflict', observed_preimage=latest_preimage, reason='preimage_changed_during_validation')
            os.replace(draft, output)
            replaced = True
            _repair(output, raw)
        except OSError as exc:
            return result('unknown_publication' if replaced else 'not_published', reason=str(exc), candidate_sha256=sha256(raw))
        finally:
            if os.path.exists(draft):
                os.unlink(draft)
        return result('published', projection_sha256=sha256(raw), accepted_completion=desired['accepted_completion'])
    finally:
        os.close(lock_fd)
