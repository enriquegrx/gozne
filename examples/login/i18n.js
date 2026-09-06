/* global window, document */
'use strict';

(() => {
  const STORAGE_KEY = 'gozne.locale';
  const SUPPORTED = ['en', 'es'];
  const spanish = {
    'app.quique.es · Wallet access': 'app.quique.es · Acceso con wallet',
    'Gozne · Sign in': 'Gozne · Iniciar sesión',
    'Gozne · Access, with intent.': 'Gozne · Acceso con intención.',
    'Skip to wallet access': 'Ir al acceso con wallet',
    'Skip to workspace': 'Ir al espacio privado',
    'Skip to content': 'Ir al contenido',
    'Go to quique.es': 'Ir a quique.es',
    'Go to your workspace': 'Ir a tu espacio privado',
    'Gozne home': 'Inicio de Gozne',
    Language: 'Idioma',
    English: 'Inglés',
    Spanish: 'Español',
    'Private access': 'Acceso privado',
    'WALLET-GATED WORKSPACE': 'ESPACIO PROTEGIDO POR WALLET',
    'Your space.': 'Tu espacio.',
    'Your keys.': 'Tus llaves.',
    'Access your private workspace with a wallet already authorized by quique.es. You will sign a message—never a transaction.':
      'Accede a tu espacio privado con una wallet autorizada por quique.es. Firmarás un mensaje, nunca una transacción.',
    'Authentication guarantees': 'Garantías de autenticación',
    'No password to store': 'Sin contraseñas que guardar',
    'No gas or network fee': 'Sin gas ni comisiones de red',
    'Your keys never leave the wallet': 'Tus llaves nunca salen de la wallet',
    'SIGN IN': 'INICIAR SESIÓN',
    'Choose your wallet': 'Elige tu wallet',
    'Not connected': 'Sin conexión',
    DISCONNECTED: 'DESCONECTADA',
    Connected: 'Conectada',
    Detected: 'Detectada',
    'Detected EVM wallet': 'Wallet EVM detectada',
    'Choose a wallet': 'Elige una wallet',
    'Rabby · not detected': 'Rabby · no detectada',
    'MetaMask · not detected': 'MetaMask · no detectada',
    'Sign in with EVM': 'Entrar con EVM',
    'Sign in with EVM ↗': 'Entrar con EVM ↗',
    'Browser wallet': 'Wallet del navegador',
    'EVM browser wallet': 'Wallet EVM del navegador',
    'Not detected': 'No detectada',
    'Any EIP-6963 compatible browser wallet will appear here.':
      'Cualquier wallet de navegador compatible con EIP-6963 aparecerá aquí.',
    'Scan again': 'Buscar de nuevo',
    'Open wallet': 'Abrir wallet',
    'Select an authorized wallet to continue.':
      'Selecciona una wallet autorizada para continuar.',
    'Open your workspace ↗': 'Abrir tu espacio ↗',
    'Sign out': 'Cerrar sesión',
    Security: 'Seguridad',
    Contact: 'Contacto',
    Inbox: 'Buzón',
    'Authentication cookie only. No invasive tracking.':
      'Solo usamos la cookie de autenticación. Sin rastreo invasivo.',
    'YOUR WALLET. YOUR ACCESS.': 'TU WALLET. TU ACCESO.',
    'Welcome back.': 'Qué bueno verte de nuevo.',
    'Sign in to open your private application.':
      'Inicia sesión para abrir tu aplicación privada.',
    'Your wallet': 'Tu wallet',
    'Choose the extension you want to use.':
      'Elige la extensión que quieres utilizar.',
    'Application ID': 'ID de aplicación',
    'EVM wallet': 'Wallet EVM',
    'Compatible browser wallets appear automatically. Your selection is always respected.':
      'Las wallets compatibles aparecen automáticamente. Siempre respetamos tu elección.',
    'Discover wallets': 'Buscar wallets',
    'or use Solana': 'o utiliza Solana',
    'Solana network': 'Red de Solana',
    Mainnet: 'Mainnet',
    Devnet: 'Devnet',
    'Sign in with Phantom': 'Entrar con Phantom',
    'Connect an authorized wallet to begin.':
      'Conecta una wallet autorizada para empezar.',
    'Open protected application ↗': 'Abrir aplicación protegida ↗',
    'Your keys stay in your wallet.': 'Tus llaves permanecen en tu wallet.',
    INTERNAL: 'INTERNO',
    WORKSPACE: 'ESPACIO',
    Workspace: 'Espacio',
    Overview: 'Resumen',
    'Signed actions': 'Acciones firmadas',
    Invitations: 'Invitaciones',
    Applications: 'Aplicaciones',
    'Users & wallets': 'Usuarios y wallets',
    Sessions: 'Sesiones',
    Deployments: 'Despliegues',
    'Audit trail': 'Registro de auditoría',
    'Self-hosted, by you.': 'Alojado por ti.',
    'Documentation ↗': 'Documentación ↗',
    'Internal workspace': 'Espacio interno',
    'Private administration': 'Administración privada',
    'ACCESS, WITH INTENT.': 'ACCESO CON INTENCIÓN.',
    'Open the right doors.': 'Abre las puertas adecuadas.',
    'Invite a wallet. Approve an exact action. Stay in control.':
      'Invita una wallet. Aprueba una acción exacta. Mantén el control.',
    '↻ Refresh': '↻ Actualizar',
    'Auto-refresh every 30 seconds': 'Actualizar cada 30 segundos',
    'Sign in to sync your workspace':
      'Inicia sesión para sincronizar el espacio',
    'Workspace summary': 'Resumen del espacio',
    'Active invitations': 'Invitaciones activas',
    'Time-limited reader access': 'Acceso de lectura temporal',
    'Awaiting approval': 'Esperando aprobación',
    'A fresh signature is required': 'Hace falta una firma nueva',
    'Executed actions': 'Acciones ejecutadas',
    'Recorded once, in this demo': 'Registradas una vez en esta demo',
    'A SMALL SIGNATURE. A CLEAR DECISION.':
      'UNA FIRMA PEQUEÑA. UNA DECISIÓN CLARA.',
    'Access is just': 'El acceso es solo',
    'the beginning.': 'el principio.',
    'Give a collaborator 30 minutes to enter. Review their deployment request, then sign exactly what you approve.':
      'Da acceso a un colaborador durante 30 minutos. Revisa su petición de despliegue y firma exactamente lo que apruebas.',
    Invite: 'Invitar',
    Approve: 'Aprobar',
    'Execute once': 'Ejecutar una vez',
    'Every approval has a purpose and an expiry.':
      'Cada aprobación tiene un propósito y una caducidad.',
    Project: 'Proyecto',
    Version: 'Versión',
    Environment: 'Entorno',
    Staging: 'Pruebas',
    Preview: 'Vista previa',
    Production: 'Producción',
    staging: 'pruebas',
    preview: 'vista previa',
    production: 'producción',
    '＋ Request simulated deployment': '＋ Solicitar despliegue simulado',
    '＋ Request action': '＋ Solicitar acción',
    'Sign in to see requests and create your first action.':
      'Inicia sesión para ver las peticiones y crear tu primera acción.',
    'Temporary invitations': 'Invitaciones temporales',
    'One wallet. Reader access. A clear deadline.':
      'Una wallet. Acceso de lectura. Un plazo claro.',
    Network: 'Red',
    'Public wallet address': 'Dirección pública de la wallet',
    '0x… or Solana address': '0x… o dirección de Solana',
    Duration: 'Duración',
    '30 minutes': '30 minutos',
    '1 hour': '1 hora',
    '4 hours': '4 horas',
    '24 hours': '24 horas',
    'Create invitation': 'Crear invitación',
    'Administrator sign-in required to manage invitations.':
      'Debes iniciar sesión como administrador para gestionar invitaciones.',
    'Choose a workspace or configure an application.':
      'Elige un espacio o configura una aplicación.',
    'Reload applications': 'Recargar aplicaciones',
    'Sign in to see your applications.':
      'Inicia sesión para ver tus aplicaciones.',
    'Application configuration': 'Configuración de la aplicación',
    'Choose an application': 'Elige una aplicación',
    'New application': 'Nueva aplicación',
    'Public HTTPS origin': 'Origen HTTPS público',
    'Private HTTPS origin': 'Origen HTTPS privado',
    'Required roles, comma-separated': 'Roles requeridos, separados por comas',
    'EVM chain IDs, comma-separated': 'IDs de cadena EVM, separados por comas',
    'Solana chains, comma-separated': 'Cadenas Solana, separadas por comas',
    'Approvals required': 'Aprobaciones requeridas',
    'Saving invalidates all sessions, invitations and pending approvals. New applications grant their creator the required roles and admin access. DNS, TLS and proxy routes must be configured separately.':
      'Guardar invalida todas las sesiones, invitaciones y aprobaciones pendientes. Las aplicaciones nuevas conceden a su creador los roles requeridos y acceso de administración. El DNS, TLS y las rutas del proxy se configuran por separado.',
    'Save application': 'Guardar aplicación',
    'Permanent access to this application.':
      'Acceso permanente a esta aplicación.',
    'Saving a policy change signs everyone out, revokes temporary invitations and cancels pending approvals across this Gozne instance. Keep related edits together in one save.':
      'Guardar un cambio de política cierra todas las sesiones, revoca las invitaciones temporales y cancela las aprobaciones pendientes de esta instancia de Gozne. Agrupa los cambios relacionados en un solo guardado.',
    'Reload users': 'Recargar usuarios',
    'Administrator sign-in required.':
      'Debes iniciar sesión como administrador.',
    'Select a user': 'Selecciona un usuario',
    'Create a new user': 'Crear un usuario nuevo',
    'User ID': 'ID de usuario',
    'Roles (comma-separated)': 'Roles (separados por comas)',
    'Clear all roles to revoke permanent access. The admin role grants administration for this application.':
      'Borra todos los roles para revocar el acceso permanente. El rol admin permite administrar esta aplicación.',
    'Public wallets': 'Wallets públicas',
    'Add wallet': 'Añadir wallet',
    'Add, disable or remove a wallet. Never enter a private key or seed phrase.':
      'Añade, desactiva o elimina una wallet. Nunca introduzcas una clave privada ni una frase semilla.',
    'Add, disable or remove public wallets. Never enter private keys or seed phrases.':
      'Añade, desactiva o elimina wallets públicas. Nunca introduzcas claves privadas ni frases semilla.',
    'Save user and apply policy': 'Guardar usuario y aplicar política',
    'Active sessions': 'Sesiones activas',
    'Close access immediately. A revoked signer also invalidates their pending approvals.':
      'Cierra el acceso al instante. Revocar un firmante también invalida sus aprobaciones pendientes.',
    'Sign in as an administrator to manage sessions.':
      'Inicia sesión como administrador para gestionar sesiones.',
    'Deployment receipts': 'Recibos de despliegue',
    'Simulated effects committed with their approvals.':
      'Efectos simulados registrados junto a sus aprobaciones.',
    'Simulation and signed webhook results.':
      'Resultados de simulación y webhooks firmados.',
    'No receipts loaded.': 'No hay recibos cargados.',
    'Recent security events for this application.':
      'Eventos de seguridad recientes de esta aplicación.',
    'Event type': 'Tipo de evento',
    'All activity': 'Toda la actividad',
    'Successful sign-ins': 'Inicios de sesión correctos',
    'Denied sign-ins': 'Inicios de sesión denegados',
    'Policy changes': 'Cambios de política',
    'Invitations created': 'Invitaciones creadas',
    'Invitations revoked': 'Invitaciones revocadas',
    'Actions requested': 'Acciones solicitadas',
    'Denied action signatures': 'Firmas de acción denegadas',
    'Actions approved': 'Acciones aprobadas',
    'Actions executed': 'Acciones ejecutadas',
    'Actions canceled': 'Acciones canceladas',
    'Sessions closed': 'Sesiones cerradas',
    'Sessions revoked by an administrator':
      'Sesiones revocadas por un administrador',
    'Sign in as an administrator to view the audit trail.':
      'Inicia sesión como administrador para ver el registro de auditoría.',
    'Load earlier events': 'Cargar eventos anteriores',
    'Session and signing wallet': 'Sesión y wallet firmante',
    'Administration session': 'Sesión de administración',
    'WHAT YOU ARE SIGNING': 'QUÉ ESTÁS FIRMANDO',
    'Messages, not transactions.': 'Mensajes, no transacciones.',
    'A login proves wallet ownership. An action signature approves the named project, version and environment.':
      'El inicio de sesión demuestra la propiedad de la wallet. La firma de una acción aprueba el proyecto, la versión y el entorno indicados.',
    'This demo records simulated deployments. It never runs a deployment or moves funds.':
      'Esta demo registra despliegues simulados. Nunca ejecuta un despliegue ni mueve fondos.',
    'Actions use the local simulation unless the operator configures a signed private webhook. Gozne never moves funds.':
      'Las acciones usan la simulación local salvo que el operador configure un webhook privado firmado. Gozne nunca mueve fondos.',
    'First time here?': '¿Es tu primera vez?',
    'The operator must attach their public wallet address to an administrator identity. Invited collaborators only need their own wallet.':
      'El operador debe asociar su dirección pública a una identidad administradora. Los colaboradores invitados solo necesitan su propia wallet.',
    'Read the setup guide ↗': 'Leer la guía de instalación ↗',
    'Gozne · Sign. Turn. Enter.': 'Gozne · Firma. Gira. Entra.',
    documentation: 'documentación',
    'Private administration · No invasive tracking':
      'Administración privada · Sin rastreo invasivo',
    'Looking for wallets. If yours is missing, enable it for this site and reload.':
      'Buscando wallets. Si falta la tuya, actívala para este sitio y recarga.',
    'The request could not be completed.': 'No se pudo completar la petición.',
    'Signed in as {identity}. Session expires at {time}.':
      'Sesión iniciada como {identity}. Caduca a las {time}.',
    'Working… Review your wallet if a signature is requested.':
      'Procesando… Revisa tu wallet si se solicita una firma.',
    'Sign-in failed.': 'No se pudo iniciar sesión.',
    'Select a detected wallet. Another wallet will never be opened in its place.':
      'Selecciona una wallet detectada. Nunca abriremos otra wallet en su lugar.',
    'This demo needs Phantom with Sign-In With Solana support.':
      'Esta demo necesita Phantom con soporte para Sign-In With Solana.',
    'Signed out.': 'Sesión cerrada.',
    'Application changed. Sign in to start a separate session.':
      'La aplicación ha cambiado. Inicia sesión para abrir una sesión independiente.',
    '{label}: completed.': '{label}: completado.',
    'Phantom with Sign-In With Solana is required.':
      'Se necesita Phantom con Sign-In With Solana.',
    'Select the wallet account used for this session.':
      'Selecciona la cuenta de wallet utilizada en esta sesión.',
    'Select a detected EVM wallet in the wallet panel.':
      'Selecciona una wallet EVM detectada en el panel de wallet.',
    'No requests yet. Create a simulated deployment above.':
      'Todavía no hay peticiones. Crea arriba un despliegue simulado.',
    'No requests yet. Create an action above.':
      'Todavía no hay peticiones. Crea una acción arriba.',
    'View signed identifiers': 'Ver identificadores firmados',
    'Requested by {requester} · Expires {expires}':
      'Solicitado por {requester} · Caduca {expires}',
    'Approved by {approver} · Approval expires {expires}':
      'Aprobado por {approver} · La aprobación caduca {expires}',
    '{count} of {required} approvals collected':
      '{count} de {required} aprobaciones reunidas',
    '{approver} · signed {signed} · expires {expires}':
      '{approver} · firmó {signed} · caduca {expires}',
    'Sign approval': 'Firmar aprobación',
    'Execute simulation once': 'Ejecutar simulación una vez',
    'Deliver approved action': 'Entregar acción aprobada',
    'Cancel request': 'Cancelar petición',
    'Your invitation grants reader access. Administration is reserved for operators.':
      'Tu invitación concede acceso de lectura. La administración está reservada a los operadores.',
    'No invitations yet. Invite a public wallet address above.':
      'Todavía no hay invitaciones. Invita arriba una dirección pública.',
    revoked: 'revocada',
    expired: 'caducada',
    accepted: 'aceptada',
    invited: 'invitada',
    'Reader · Expires {expires}': 'Lectura · Caduca {expires}',
    'Revoke access': 'Revocar acceso',
    'Executed simulations will appear here. No infrastructure is changed.':
      'Las simulaciones ejecutadas aparecerán aquí. No se modifica infraestructura.',
    'Executed action receipts will appear here.':
      'Los recibos de acciones ejecutadas aparecerán aquí.',
    '{environment} · Simulated · {date}': '{environment} · Simulado · {date}',
    '{environment} · {mode} · {date}': '{environment} · {mode} · {date}',
    'Signed webhook': 'Webhook firmado',
    Simulated: 'Simulado',
    'Receiver status {status} · Response SHA-256 {digest}':
      'Estado del receptor {status} · SHA-256 de respuesta {digest}',
    'Public address': 'Dirección pública',
    Enabled: 'Activa',
    Remove: 'Eliminar',
    'These wallets are shared across applications or belong to an application manager. Only application roles can be edited here; use the operator CLI for wallet changes.':
      'Estas wallets se comparten entre aplicaciones o pertenecen a un gestor de aplicaciones. Aquí solo puedes editar los roles; utiliza la CLI del operador para cambiar wallets.',
    'No access': 'Sin acceso',
    '{count} users in {application}. Required roles: {roles}. Reloading discards unsaved edits.':
      '{count} usuarios en {application}. Roles requeridos: {roles}. Recargar descarta los cambios sin guardar.',
    none: 'ninguno',
    'Only administrators can manage active sessions.':
      'Solo los administradores pueden gestionar sesiones activas.',
    'No active sessions.': 'No hay sesiones activas.',
    'This session': 'Esta sesión',
    'Started {started} · Expires {expires}':
      'Iniciada {started} · Caduca {expires}',
    'Revoke session': 'Revocar sesión',
    'Updated {time}': 'Actualizado a las {time}',
    'Session ended': 'Sesión terminada',
    'Connection interrupted; retrying': 'Conexión interrumpida; reintentando',
    'Could not load the workspace: {message} Refresh or sign in again.':
      'No se pudo cargar el espacio: {message} Actualiza o inicia sesión de nuevo.',
    'Reload users from an administrator session.':
      'Recarga los usuarios desde una sesión de administrador.',
    'User saved. Policy changed; all sessions and temporary grants were invalidated. Sign in again.':
      'Usuario guardado. La política ha cambiado; se invalidaron todas las sesiones y permisos temporales. Inicia sesión de nuevo.',
    'No policy changes were needed. Your session remains active.':
      'No fue necesario cambiar la política. Tu sesión sigue activa.',
    'Request created. An administrator can now sign the exact deployment.':
      'Petición creada. Un administrador ya puede firmar el despliegue exacto.',
    'Request created. An administrator can now sign the exact action.':
      'Petición creada. Un administrador ya puede firmar la acción exacta.',
    'Invite created for {address} until {expires}. Share this address: ':
      'Invitación creada para {address} hasta {expires}. Comparte esta dirección: ',
    'Invitation created. Only that wallet can use it; the link carries no access token.':
      'Invitación creada. Solo esa wallet puede usarla; el enlace no contiene ningún token de acceso.',
    'No audit events match this filter.':
      'Ningún evento de auditoría coincide con este filtro.',
    System: 'Sistema',
    'Session {session}': 'Sesión {session}',
    'login.succeeded': 'Inicio de sesión correcto',
    'login.denied': 'Inicio de sesión denegado',
    'session.revoked': 'Sesión cerrada',
    'session.revoked-by-admin': 'Sesión revocada por un administrador',
    'policy.applied': 'Política aplicada',
    'invitation.created': 'Invitación creada',
    'invitation.revoked': 'Invitación revocada',
    'action.requested': 'Acción solicitada',
    'action.proof-denied': 'Firma de acción denegada',
    'action.approved': 'Acción aprobada',
    'action.executed': 'Acción ejecutada',
    'action.delivery-failed': 'Entrega de acción fallida',
    'action.canceled': 'Acción cancelada',
    'Application manager access. Select an application to edit its configuration.':
      'Acceso de gestor de aplicaciones. Selecciona una aplicación para editarla.',
    'Your accessible applications. Configuration requires an application manager.':
      'Tus aplicaciones accesibles. Para configurarlas hace falta un gestor de aplicaciones.',
    'Current workspace': 'Espacio actual',
    'Open workspace': 'Abrir espacio',
    'Application manager access required.':
      'Se necesita acceso de gestor de aplicaciones.',
    'Application saved. Sign in again; all sessions and temporary grants were invalidated.':
      'Aplicación guardada. Inicia sesión de nuevo; se invalidaron todas las sesiones y permisos temporales.',
    'No changes were needed.': 'No fue necesario hacer cambios.',
    'Your session is active.': 'Tu sesión está activa.',
    'Could not sign out. Try again.':
      'No se pudo cerrar la sesión. Inténtalo de nuevo.',
    'Could not check your session. Reload to retry.':
      'No se pudo comprobar tu sesión. Recarga para reintentarlo.',
    'Connection interrupted. Retrying shortly.':
      'Conexión interrumpida. Reintentaremos en breve.',
    'app.quique.es · Workspace': 'app.quique.es · Espacio privado',
    'Wallet verified': 'Wallet verificada',
    'PRIVATE WORKSPACE': 'ESPACIO PRIVADO',
    'Welcome, {identity}.': 'Hola, {identity}.',
    'Your personal space, opened with your wallet.':
      'Tu espacio personal, abierto con tu wallet.',
    'Your account': 'Tu cuenta',
    AUTHORIZED: 'AUTORIZADA',
    Identity: 'Identidad',
    Application: 'Aplicación',
    Permissions: 'Permisos',
    Wallet: 'Wallet',
    'Session expires': 'La sesión caduca',
    'Checking your current session.': 'Comprobando tu sesión actual.',
    Resources: 'Recursos',
    'Public website': 'Web pública',
    'Share secrets securely': 'Comparte secretos de forma segura',
    'Security information and contact': 'Información de seguridad y contacto',
    'This workspace is the starting point for your private tools.':
      'Este espacio es el punto de partida de tus herramientas privadas.',
  };

  const interpolate = (text, values = {}) =>
    text.replace(/\{([a-zA-Z]+)\}/g, (match, key) =>
      Object.hasOwn(values, key) ? String(values[key]) : match,
    );
  const normalize = (value) =>
    SUPPORTED.includes(String(value).toLowerCase().split('-')[0])
      ? String(value).toLowerCase().split('-')[0]
      : null;
  const requested = (() => {
    try {
      return new URLSearchParams(window.location.search).get('lang');
    } catch {
      return null;
    }
  })();
  const storedLocale = (() => {
    try {
      return window.localStorage?.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  })();
  let locale =
    normalize(requested) ||
    normalize(storedLocale) ||
    normalize(navigator.language) ||
    'en';
  const originalText = new WeakMap();
  const originalAttributes = new WeakMap();

  function t(source, values) {
    const translated = locale === 'es' ? spanish[source] || source : source;
    return interpolate(translated, values);
  }

  function translateText(root) {
    const walker = document.createTreeWalker(root, window.NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (['SCRIPT', 'STYLE'].includes(node.parentElement?.tagName)) continue;
      if (!originalText.has(node)) originalText.set(node, node.nodeValue);
      const source = originalText.get(node);
      const trimmed = source.trim();
      const key = trimmed.replace(/\s+/g, ' ');
      if (!key || !spanish[key]) {
        node.nodeValue = source;
        continue;
      }
      const leading = source.slice(0, source.indexOf(trimmed));
      const trailing = source.slice(source.indexOf(trimmed) + trimmed.length);
      node.nodeValue = `${leading}${t(key)}${trailing}`;
    }
  }

  function translateAttributes(root) {
    for (const element of root.querySelectorAll(
      '[placeholder], [aria-label], [title], [data-i18n]',
    )) {
      let originals = originalAttributes.get(element);
      if (!originals) {
        originals = {};
        originalAttributes.set(element, originals);
      }
      for (const attribute of ['placeholder', 'aria-label', 'title']) {
        if (!element.hasAttribute(attribute)) continue;
        originals[attribute] ??= element.getAttribute(attribute);
        element.setAttribute(attribute, t(originals[attribute]));
      }
      const key = element.dataset.i18n;
      if (key) {
        const values = {};
        for (const [name, value] of Object.entries(element.dataset)) {
          if (name.startsWith('i18n') && name !== 'i18n')
            values[name.slice(4, 5).toLowerCase() + name.slice(5)] = value;
        }
        element.textContent = t(key, values);
      }
    }
  }

  function renderSwitchers() {
    for (const container of document.querySelectorAll(
      '[data-language-switcher]',
    )) {
      container.replaceChildren();
      container.classList.add('language-switcher');
      container.setAttribute('role', 'group');
      container.setAttribute('aria-label', t('Language'));
      for (const code of SUPPORTED) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.locale = code;
        button.textContent = code.toUpperCase();
        button.title = t(code === 'en' ? 'English' : 'Spanish');
        button.setAttribute('aria-pressed', String(code === locale));
        button.addEventListener('click', () => setLocale(code));
        container.append(button);
      }
    }
  }

  function apply(root = document) {
    document.documentElement.lang = locale;
    translateText(root);
    translateAttributes(root);
    if (root === document) {
      document.title = t(originalTitle);
      renderSwitchers();
    }
  }

  function setLocale(value) {
    const next = normalize(value);
    if (!next || next === locale) return;
    locale = next;
    try {
      window.localStorage?.setItem(STORAGE_KEY, locale);
    } catch {
      // A blocked local store should not prevent language changes in this tab.
    }
    apply();
    window.dispatchEvent(
      new window.CustomEvent('gozne:languagechange', { detail: { locale } }),
    );
  }

  const originalTitle = document.title;
  window.GozneI18n = {
    apply,
    formatDate: (value, options) =>
      new Intl.DateTimeFormat(locale, options).format(new Date(value)),
    formatTime: (value) =>
      new Intl.DateTimeFormat(locale, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date(value)),
    get locale() {
      return locale;
    },
    setLocale,
    t,
  };
  apply();
})();
