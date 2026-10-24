'use client';
import {useEffect,useState} from 'react';
import {Alert,Box,Button,Chip,Dialog,DialogActions,DialogContent,DialogTitle,Divider,IconButton,Stack,TextField,Tooltip,Typography} from '@mui/material';
import {BugReport as BugReportIcon,ContentCopy as ContentCopyIcon,Key as KeyIcon,Link as LinkIcon,LinkOff as LinkOffIcon,ReceiptLong as ReceiptLongIcon,ScreenShare as ScreenShareIcon} from '@mui/icons-material';
import {api} from '../../lib/api';

const fmt=value=>value?new Date(value.includes('T')?value:value.replace(' ','T')+'Z').toLocaleString('pt-BR'):'-';
const channelStyle=channel=>({test:{bgcolor:'#7b1fa2',color:'#fff'},beta:{bgcolor:'#1976d2',color:'#fff'},production:{bgcolor:'#2e7d32',color:'#fff'}}[channel]||{});
const sourceLabel={installer:'Link de instalação',check:'Servidor'};

// navigator.clipboard só existe em contexto seguro; em http cai no execCommand.
async function copyText(value){
  try{await navigator.clipboard.writeText(value);return true}catch{
    const area=document.createElement('textarea');area.value=value;area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();
    try{return document.execCommand('copy')}finally{area.remove()}
  }
}

function RemoteAccess({client,admin,items,reload}){
  const [config,setConfig]=useState(null),[links,setLinks]=useState([]),[created,setCreated]=useState(null),[revealed,setRevealed]=useState({}),[busy,setBusy]=useState(false),[message,setMessage]=useState(null);
  const notify=(text,severity='success')=>setMessage({severity,text});
  async function loadLinks(){try{setLinks(await api(`/admin/clients/${client.id}/remote-access/links`))}catch(e){notify(e.message,'error')}}
  useEffect(()=>{setCreated(null);setRevealed({});setMessage(null);api('/admin/remote-access/config').then(setConfig).catch(()=>setConfig({configured:false}));loadLinks()},[client.id]);
  const copy=async(value,label)=>notify(await copyText(value)?`${label} copiado.`:`Não foi possível copiar: ${label.toLowerCase()}.`,'info');
  async function createLink(){setBusy(true);try{const link=await api(`/admin/clients/${client.id}/remote-access/links`,{method:'POST',body:JSON.stringify({})});setCreated(link);await loadLinks();notify(await copyText(link.url)?'Link gerado e copiado.':'Link gerado.')}catch(e){notify(e.message,'error')}finally{setBusy(false)}}
  async function revoke(link){if(!confirm('Revogar este link de instalação?'))return;try{await api(`/admin/remote-access/links/${link.id}`,{method:'DELETE'});if(created?.id===link.id)setCreated(null);await loadLinks();notify('Link revogado.')}catch(e){notify(e.message,'error')}}
  async function reveal(item){try{const data=await api(`/admin/remote-access/${item.id}/password`,{method:'POST'});setRevealed(current=>({...current,[item.id]:data.password}))}catch(e){notify(e.message,'error')}}
  // A senha não vai na URI: o RustDesk não documenta esse parâmetro. Ela é copiada para colar no prompt.
  async function connect(item){
    const password=revealed[item.id],copied=password&&await copyText(password);
    window.location.href=`rustdesk://connection/new/${encodeURIComponent(item.remote_id)}`;
    notify(copied?'Abrindo o RustDesk. A senha foi copiada; cole quando ele pedir.':'Abrindo o RustDesk.','info');
  }
  const activeLinks=links.filter(link=>link.status==='active');
  return <Box mt={3}>
    <Divider/>
    <Stack direction={{xs:'column',sm:'row'}} justifyContent="space-between" alignItems={{sm:'center'}} spacing={1} mt={2} mb={1.5}>
      <Box><Typography variant="h6">Acesso remoto</Typography><Typography variant="body2" color="text.secondary">RustDesk no servidor próprio{config?.idServer?` (${config.idServer})`:''}.</Typography></Box>
      <Stack direction="row" spacing={1}>
        <Button onClick={()=>{reload();loadLinks()}} disabled={busy}>Atualizar</Button>
        <Tooltip title={config&&!config.configured?'Configure RUSTDESK_* e REMOTE_ACCESS_SECRET no backend.':''}><span><Button variant="contained" startIcon={<LinkIcon/>} disabled={busy||!config?.configured} onClick={createLink}>Gerar link</Button></span></Tooltip>
      </Stack>
    </Stack>
    {message&&<Alert severity={message.severity} onClose={()=>setMessage(null)} sx={{mb:1.5}}>{message.text}</Alert>}
    {created&&<Alert severity="success" icon={false} sx={{mb:1.5,'& .MuiAlert-message':{width:'100%'}}}>
      <Typography variant="body2" mb={1}>Envie este link ao cliente. Ele vale até {fmt(created.expiresAt)} e serve para uma instalação. Depois de fechar este diálogo o link não aparece de novo.</Typography>
      <Stack direction="row" spacing={1}><TextField size="small" fullWidth value={created.url} slotProps={{input:{readOnly:true}}} onFocus={e=>e.target.select()}/><Button variant="outlined" startIcon={<ContentCopyIcon/>} onClick={()=>copy(created.url,'Link')}>Copiar</Button></Stack>
    </Alert>}
    <Box sx={{overflowX:'auto'}}><Box sx={{minWidth:950}}>
      <Box sx={{display:'grid',gridTemplateColumns:'1.1fr 1.4fr 1fr 1fr 1fr 1.6fr',gap:2,p:1,fontWeight:700}}>{['ID','Terminal / computador','Origem','Senha alterada','Último contato','Ações'].map(x=><Box key={x}>{x}</Box>)}</Box>
      {items.map(item=><Box key={item.id} sx={{display:'grid',gridTemplateColumns:'1.1fr 1.4fr 1fr 1fr 1fr 1.6fr',gap:2,p:1.5,borderTop:'1px solid',borderColor:'divider',alignItems:'center'}}>
        <Stack direction="row" alignItems="center" spacing={.5}><Typography fontFamily="monospace">{item.remote_id}</Typography><Tooltip title="Copiar ID"><IconButton size="small" onClick={()=>copy(item.remote_id,'ID')}><ContentCopyIcon fontSize="inherit"/></IconButton></Tooltip></Stack>
        <Box>{item.terminal_name||<Typography component="span" variant="body2" color="text.secondary">Sem terminal</Typography>}<Typography variant="body2" color="text.secondary">{item.terminal_computer_name||item.computer_name||'-'}</Typography></Box>
        <Box>{sourceLabel[item.source]||item.source}</Box>
        <Box>{fmt(item.password_updated_at)}</Box>
        <Box>{fmt(item.last_seen_at)}</Box>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Button size="small" variant="contained" startIcon={<ScreenShareIcon/>} onClick={()=>connect(item)}>Conectar</Button>
          {admin&&item.has_password&&(revealed[item.id]
            ?<Tooltip title="Copiar senha"><Chip label={revealed[item.id]} sx={{fontFamily:'monospace'}} icon={<ContentCopyIcon/>} onClick={()=>copy(revealed[item.id],'Senha')}/></Tooltip>
            :<Button size="small" startIcon={<KeyIcon/>} onClick={()=>reveal(item)}>Senha</Button>)}
        </Stack>
      </Box>)}
    </Box></Box>
    {!items.length&&<Typography color="text.secondary" mt={1}>Nenhum acesso remoto registrado para este cliente.</Typography>}
    {!!activeLinks.length&&<Box mt={2}>
      <Typography variant="subtitle2" mb={1}>Links pendentes</Typography>
      {activeLinks.map(link=><Stack key={link.id} direction="row" spacing={1.5} alignItems="center" sx={{py:.75,borderTop:'1px solid',borderColor:'divider'}}>
        <Chip size="small" label="Ativo" color="success"/>
        <Typography variant="body2" sx={{flex:1}}>Gerado em {fmt(link.created_at)}{link.created_by_name?` por ${link.created_by_name}`:''} · expira em {fmt(link.expires_at)}</Typography>
        <Tooltip title="Revogar link"><IconButton size="small" onClick={()=>revoke(link)}><LinkOffIcon fontSize="small"/></IconButton></Tooltip>
      </Stack>)}
    </Box>}
  </Box>;
}

export default function ClientTerminalsDialog({client,terminals,admin,close,showLog,showErrors}){
  const [remote,setRemote]=useState([]);
  async function loadRemote(){try{setRemote(await api(`/admin/clients/${client.id}/remote-access`))}catch{setRemote([])}}
  useEffect(()=>{setRemote([]);if(client)loadRemote()},[client?.id]);
  const sorted=[...terminals].sort((a,b)=>
    String(a.product_code||'').localeCompare(String(b.product_code||''),'pt-BR',{sensitivity:'base'})||
    String(a.channel||'').localeCompare(String(b.channel||''),'pt-BR',{sensitivity:'base'})||
    String(a.current_version||'').localeCompare(String(b.current_version||''),'pt-BR',{numeric:true,sensitivity:'base'})
  );
  const remoteByTerminal=Object.fromEntries(remote.filter(item=>item.terminal_id).map(item=>[item.terminal_id,item]));
  return <Dialog open={!!client} fullWidth maxWidth="lg" onClose={close}><DialogTitle>Terminais de {client?.name}</DialogTitle><DialogContent><Box sx={{overflowX:'auto'}}><Box sx={{minWidth:1050}}><Box sx={{display:'grid',gridTemplateColumns:'repeat(8,1fr)',gap:2,p:1,fontWeight:700}}>{['Terminal','Computador','Produto','Canal','Versão','Último contato','Acesso remoto','Ações'].map(x=><Box key={x}>{x}</Box>)}</Box>{sorted.map(terminal=><Box key={terminal.id} sx={{display:'grid',gridTemplateColumns:'repeat(8,1fr)',gap:2,p:1.5,borderTop:'1px solid',borderColor:'divider',alignItems:'center'}}><Box>{terminal.name}</Box><Box>{terminal.computer_name||'-'}</Box><Box>{terminal.product_code}</Box><Box><Chip size="small" label={terminal.channel} sx={channelStyle(terminal.channel)}/></Box><Box>{terminal.current_version}</Box><Box>{fmt(terminal.last_seen_at)}</Box><Box>{remoteByTerminal[terminal.id]?<Chip size="small" icon={<ScreenShareIcon/>} label={remoteByTerminal[terminal.id].remote_id} sx={{fontFamily:'monospace'}}/>:'-'}</Box><Stack direction="row" spacing={1}><Button size="small" startIcon={<ReceiptLongIcon/>} onClick={()=>showLog(terminal)} aria-label="Ver log"/><Button size="small" startIcon={<BugReportIcon/>} onClick={()=>showErrors(terminal)} aria-label="Ver erros"/></Stack></Box>)}</Box></Box>{!terminals.length&&<Typography color="text.secondary" mt={2}>Nenhum terminal cadastrado.</Typography>}{client&&<RemoteAccess client={client} admin={admin} items={remote} reload={loadRemote}/>}</DialogContent><DialogActions><Button onClick={close}>Fechar</Button></DialogActions></Dialog>;
}
