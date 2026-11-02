const authDialog = document.getElementById('authDialog');
const adminDialog = document.getElementById('adminDialog');
const authForm = document.getElementById('authForm');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authTitle = document.getElementById('authTitle');
const authDescription = document.getElementById('authDescription');
const authSubmit = document.getElementById('authSubmit');
const authModeButton = document.getElementById('authModeButton');
const authFeedback = document.getElementById('authFeedback');
const adminFeedback = document.getElementById('adminFeedback');
const accountButton = document.getElementById('accountButton');
const adminButton = document.getElementById('adminButton');
const playersTableBody = document.getElementById('playersTableBody');

let supabase = null;
let currentUser = null;
let owner = false;
let authMode = 'signin';

function setFeedback(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle('error', isError);
}

function setAuthMode(mode) {
  authMode = mode;
  const creating = mode === 'signup';
  authTitle.textContent = creating ? 'Create account' : 'Sign in';
  authSubmit.textContent = creating ? 'Create account' : 'Sign in';
  authModeButton.textContent = creating ? 'Already have an account? Sign in' : 'Create an account';
  authDescription.textContent = creating
    ? 'Create an account to save match results.'
    : 'Sign in to save your match results.';
  authPassword.autocomplete = creating ? 'new-password' : 'current-password';
  setFeedback(authFeedback, '');
}

function setAccountControls(user, isOwner) {
  currentUser = user;
  owner = isOwner;
  accountButton.textContent = user ? 'Sign out' : 'Sign in';
  adminButton.hidden = !user || !isOwner;
}

function showAuthDialog() {
  setAuthMode('signin');
  if (!supabase) {
    setFeedback(authFeedback, 'Add your Supabase project URL and anon key in supabase-config.js, then reload.');
  }
  authDialog.showModal();
}

function showEmptyPlayers(message) {
  playersTableBody.replaceChildren();
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = 6;
  cell.className = 'empty-row';
  cell.textContent = message;
  row.append(cell);
  playersTableBody.append(row);
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function addCell(row, value) {
  const cell = document.createElement('td');
  cell.textContent = value;
  row.append(cell);
  return cell;
}

function renderPlayers(players) {
  playersTableBody.replaceChildren();
  if (!players.length) {
    showEmptyPlayers('No player accounts yet.');
    return;
  }

  for (const player of players) {
    const row = document.createElement('tr');
    const identity = addCell(row, player.display_name || player.email);
    identity.title = player.email;
    addCell(row, String(player.total_sessions));
    addCell(row, String(player.best_score));
    addCell(row, formatDate(player.last_seen));

    const roleCell = document.createElement('td');
    if (player.role === 'owner') {
      const ownerLabel = document.createElement('span');
      ownerLabel.className = 'status-pill owner-pill';
      ownerLabel.textContent = 'Owner';
      roleCell.append(ownerLabel);
    } else {
      const roleSelect = document.createElement('select');
      roleSelect.className = 'role-select';
      roleSelect.dataset.playerId = player.player_id;
      roleSelect.setAttribute('aria-label', `Role for ${player.email}`);
      for (const [value, label] of [
        ['player', 'Player'],
        ['moderator', 'Moderator'],
        ['admin', 'Admin'],
        ['vip', 'VIP'],
      ]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        roleSelect.append(option);
      }
      roleSelect.value = player.role;
      roleCell.append(roleSelect);
    }
    row.append(roleCell);

    const actionCell = document.createElement('td');
    const status = document.createElement('span');
    status.className = `status-pill${player.is_banned ? ' banned' : ''}`;
    status.textContent = player.is_banned ? 'Suspended' : 'Active';
    actionCell.append(status);

    if (player.role !== 'owner') {
      const button = document.createElement('button');
      button.className = 'table-action';
      button.type = 'button';
      button.textContent = player.is_banned ? 'Restore' : 'Suspend';
      button.dataset.playerId = player.player_id;
      button.dataset.ban = String(!player.is_banned);
      button.setAttribute('aria-label', `${player.is_banned ? 'Restore' : 'Suspend'} ${player.email}`);
      actionCell.append(document.createTextNode(' '), button);
    }
    row.append(actionCell);
    playersTableBody.append(row);
  }
}

async function loadDashboard() {
  if (!supabase || !owner) {
    setFeedback(adminFeedback, 'Owner access required.', true);
    return;
  }

  setFeedback(adminFeedback, 'Loading owner data…');
  let metricsResult;
  let playersResult;
  try {
    [metricsResult, playersResult] = await Promise.all([
      supabase.rpc('owner_dashboard_metrics'),
      supabase.rpc('owner_list_players'),
    ]);
  } catch (error) {
    setFeedback(adminFeedback, `Could not load dashboard: ${error.message}`, true);
    return;
  }

  if (metricsResult.error || playersResult.error) {
    const error = metricsResult.error || playersResult.error;
    setFeedback(adminFeedback, `Could not load dashboard: ${error.message}`, true);
    return;
  }

  const metrics = metricsResult.data?.[0];
  if (!metrics) {
    setFeedback(adminFeedback, 'The dashboard returned no metrics.', true);
    return;
  }

  document.getElementById('metricPlayers').textContent = String(metrics.player_count);
  document.getElementById('metricMatches').textContent = String(metrics.session_count);
  document.getElementById('metricAverage').textContent = String(metrics.average_score);
  document.getElementById('metricBest').textContent = String(metrics.best_score);
  renderPlayers(playersResult.data || []);
  setFeedback(adminFeedback, 'Owner data is up to date.');
}

async function handleSession(session) {
  const user = session?.user || null;
  if (!user || !supabase) {
    setAccountControls(null, false);
    if (adminDialog.open) adminDialog.close();
    window.dispatchEvent(new CustomEvent('game:access', { detail: { blocked: false } }));
    return;
  }

  const [ownerResult, profileResult] = await Promise.all([
    supabase.rpc('is_owner'),
    supabase.from('profiles').select('is_banned').eq('id', user.id).maybeSingle(),
  ]);

  if (ownerResult.error) {
    setAccountControls(user, false);
    setFeedback(authFeedback, `Could not verify owner access: ${ownerResult.error.message}`, true);
    return;
  }

  if (profileResult.error) {
    setAccountControls(user, Boolean(ownerResult.data));
    setFeedback(authFeedback, `Could not load player account: ${profileResult.error.message}`, true);
    return;
  }

  const isBanned = Boolean(profileResult.data?.is_banned);
  setAccountControls(user, Boolean(ownerResult.data));
  window.dispatchEvent(new CustomEvent('game:access', { detail: { blocked: isBanned } }));

  if (isBanned) {
    setFeedback(authFeedback, 'This account has been suspended. Contact the game owner for assistance.', true);
    if (!authDialog.open) authDialog.showModal();
  } else if (authDialog.open) {
    authDialog.close();
  }

  if (owner && adminDialog.open) {
    await loadDashboard();
  }
}

async function initializeSupabase() {
  const config = window.SUPABASE_CONFIG;
  if (!config?.url || !config?.anonKey) return;

  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    supabase = createClient(config.url, config.anonKey);
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    await handleSession(data.session);
    supabase.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => void handleSession(session), 0);
    });
  } catch (error) {
    setFeedback(authFeedback, `Supabase could not be initialized: ${error.message}`, true);
  }
}

accountButton.addEventListener('click', async () => {
  if (currentUser && supabase) {
    const { error } = await supabase.auth.signOut();
    if (error) setFeedback(authFeedback, `Sign out failed: ${error.message}`, true);
    return;
  }
  showAuthDialog();
});

document.getElementById('closeAuthButton').addEventListener('click', () => authDialog.close());
document.getElementById('closeAdminButton').addEventListener('click', () => adminDialog.close());
authModeButton.addEventListener('click', () => {
  setAuthMode(authMode === 'signin' ? 'signup' : 'signin');
});

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!supabase) {
    setFeedback(authFeedback, 'Supabase is not configured. Add your project URL and anon key in supabase-config.js.', true);
    return;
  }

  const email = authEmail.value.trim().toLowerCase();
  const password = authPassword.value;
  authSubmit.disabled = true;
  setFeedback(authFeedback, authMode === 'signup' ? 'Creating account…' : 'Signing in…');

  try {
    const result = authMode === 'signup'
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
    if (result.error) throw result.error;
    if (authMode === 'signup' && !result.data.session) {
      setFeedback(authFeedback, 'Check your email to confirm your account, then sign in.');
    } else {
      setFeedback(authFeedback, 'Signed in.');
      await handleSession(result.data.session);
    }
  } catch (error) {
    setFeedback(authFeedback, error.message, true);
  } finally {
    authSubmit.disabled = false;
  }
});

adminButton.addEventListener('click', async () => {
  if (!owner) {
    setFeedback(adminFeedback, 'Owner access required.', true);
    return;
  }
  adminDialog.showModal();
  await loadDashboard();
});

document.getElementById('refreshAdminButton').addEventListener('click', () => {
  void loadDashboard();
});

playersTableBody.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement) || !target.dataset.playerId || !supabase || !owner) return;

  target.disabled = true;
  setFeedback(adminFeedback, 'Updating player access…');
  try {
    const { error } = await supabase.rpc('owner_set_player_banned', {
      target_player_id: target.dataset.playerId,
      should_ban: target.dataset.ban === 'true',
    });
    if (error) throw error;
  } catch (error) {
    setFeedback(adminFeedback, `Could not update player: ${error.message}`, true);
    target.disabled = false;
    return;
  }
  await loadDashboard();
});

playersTableBody.addEventListener('change', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement) || !target.dataset.playerId || !supabase || !owner) return;

  target.disabled = true;
  setFeedback(adminFeedback, 'Updating player role…');
  try {
    const { error } = await supabase.rpc('owner_set_player_role', {
      target_player_id: target.dataset.playerId,
      new_role: target.value,
    });
    if (error) throw error;
    await loadDashboard();
  } catch (error) {
    setFeedback(adminFeedback, `Could not update role: ${error.message}`, true);
    target.disabled = false;
  }
});

document.addEventListener('keydown', (event) => {
  const target = event.target;
  if (
    (!owner) ||
    (event.key !== '[' && event.code !== 'BracketLeft') ||
    event.repeat ||
    (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]'))
  ) {
    return;
  }

  event.preventDefault();
  if (adminDialog.open) {
    adminDialog.close();
  } else {
    adminDialog.showModal();
    void loadDashboard();
  }
});

window.addEventListener('game:finished', async (event) => {
  if (!supabase || !currentUser || event.detail?.score == null) return;
  const { score, wave, durationSeconds } = event.detail;
  try {
    const { error } = await supabase.from('game_sessions').insert({
      user_id: currentUser.id,
      score,
      wave,
      duration_seconds: durationSeconds,
    });
    if (error) throw error;
  } catch (error) {
    setFeedback(authFeedback, `Could not save match result: ${error.message}`, true);
  }
});

document.querySelectorAll('.ui-dialog').forEach((dialog) => {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
});

setAuthMode('signin');
showEmptyPlayers('Sign in as an owner to load accounts.');
void initializeSupabase();
