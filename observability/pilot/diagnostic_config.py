"""Pure rendering of the inert, isolated Tempo shutdown diagnostic drafts."""
from dataclasses import dataclass
from pathlib import Path
import os
import re
import stat


AEON_ROOT = Path('/home/aya-hmw/Documents/ChatGPT/AEON')
COMPONENTS = ('tempo', 'alloy', 'prometheus', 'grafana')
CONFIGS = ('README.md', 'config.alloy', 'grafana.ini', 'hermes_otel.synthetic.yaml',
           'prometheus.yaml', 'provisioning/datasources/local.yaml', 'tempo.yaml')


def _replace_line(text, old, new):
    separator = '=' if '=' in old else ':'
    prefix = old.split(separator, 1)[0] + separator
    matches = re.findall(r'^' + re.escape(prefix) + r'[^\n]*$', text, re.MULTILINE)
    if matches != [old.rstrip('\n')]:
        raise ValueError('diagnostic template control is missing, duplicated or changed')
    return text.replace(old, new)


@dataclass(frozen=True)
class DiagnosticSpec:
    run_id: str
    aeon_root: Path = AEON_ROOT
    source_root: Path = Path(__file__).parent

    def __post_init__(self):
        if not isinstance(self.run_id, str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9]{0,31}', self.run_id):
            raise ValueError('invalid diagnostic run ID')
        for name in ('aeon_root', 'source_root'):
            path = Path(getattr(self, name))
            if not path.is_absolute() or '..' in path.parts:
                raise ValueError('diagnostic root must be an absolute unambiguous path')
            object.__setattr__(self, name, path)
        self._validate_paths()
        if self.state.exists() or self.state.is_symlink():
            raise ValueError('diagnostic namespace already exists')

    def _validate_paths(self):
        uid = os.getuid()
        for target in (self.state, self.source_root):
            for path in reversed((target, *target.parents)):
                try:
                    info = path.lstat()
                except FileNotFoundError:
                    continue
                if not stat.S_ISDIR(info.st_mode):
                    raise ValueError('diagnostic ancestor is not a directory or is a symlink')
                within_root = path.is_relative_to(self.aeon_root)
                if within_root and info.st_uid != uid:
                    raise ValueError('diagnostic ancestor is not owned by this user')
                private = path.is_relative_to(self.aeon_root / 'var')
                if private and info.st_mode & 0o022:
                    raise ValueError('diagnostic state ancestor is writable by other users')
                if info.st_uid != uid and info.st_mode & 0o022 and not info.st_mode & stat.S_ISVTX:
                    raise ValueError('diagnostic ancestor is foreign and writable')

    @property
    def state(self):
        return self.aeon_root / 'var/tempo-shutdown-check' / self.run_id

    @property
    def evidence(self):
        return self.state / 'evidence'

    @property
    def home(self):
        return self.state / 'home'

    @property
    def config(self):
        return self.state / 'config'

    @property
    def units_dir(self):
        return self.state / 'units'

    @property
    def unit_names(self):
        return {component: f'aeon-tempo-check-{component}-{self.run_id}.service'
                for component in COMPONENTS}

    @property
    def emitter_name(self):
        return f'aeon-tempo-check-emitter-{self.run_id}.scope'

    def render(self, runtime_seconds):
        if type(runtime_seconds) is not int or not 0 < runtime_seconds <= 775:
            raise ValueError('diagnostic runtime must be an integer from 1 through 775 seconds')
        self._validate_paths()
        def rebind(text):
            return text.replace(str(AEON_ROOT / 'var/observability-pilot'), str(self.state)).replace(
                str(AEON_ROOT / 'observability/pilot/config'), str(self.config))
        result = {'config/' + name: rebind((self.source_root / 'config' / name).read_text())
                  for name in CONFIGS}
        result['config/tempo.yaml'] = _replace_line(result['config/tempo.yaml'], '  log_level: warn\n', '  log_level: info\n')
        for component, name in self.unit_names.items():
            text = (self.source_root / 'units' / f'aeon-pilot-{component}.service').read_text()
            text = _replace_line(text, 'RuntimeMaxSec=30min\n', f'RuntimeMaxSec={runtime_seconds}s\n')
            stop_seconds = 90 if component == 'tempo' else 25
            text = _replace_line(text, 'TimeoutStopSec=25s\n', f'TimeoutStopSec={stop_seconds}s\nKillMode=control-group\n')
            if component == 'tempo':
                flags = ' '.join(f'-distributor.log-{kind}-spans.{field}=false'
                                 for kind in ('received', 'discarded')
                                 for field in ('enabled', 'include-attributes'))
                text, count = re.subn(r'^(ExecStart=.*)$', lambda match: match[1] + ' ' + flags,
                                     text, flags=re.MULTILINE)
                if count != 1:
                    raise ValueError('diagnostic Tempo ExecStart is missing or duplicated')
            result['units/' + name] = rebind(text)
        return result
