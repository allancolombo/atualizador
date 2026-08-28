'use client';
import {useEffect,useState} from 'react';
import {Alert,Button,Checkbox,Dialog,DialogActions,DialogContent,DialogTitle,FormControlLabel,FormGroup,Stack,Typography} from '@mui/material';
import {api} from '../../lib/api';

const channels=[['test','Test'],['beta','Beta'],['production','Producao']];

export default function ApiTokenDialog({open,close,products}){
  const [scope,setScope]=useState({productIds:[],channels:[]}),[token,setToken]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{if(!open)return;setToken('');setError('');api('/admin/me/api-token').then(data=>setScope({productIds:data.productIds||[],channels:data.channels||[]})).catch(e=>setError(e.message))},[open]);
  const toggle=(key,value)=>setScope(current=>({...current,[key]:current[key].includes(value)?current[key].filter(item=>item!==value):[...current[key],value]}));
  async function generate(){if(!scope.productIds.length||!scope.channels.length){setError('Selecione pelo menos um produto e um ambiente.');return}try{setBusy(true);setError('');setToken((await api('/admin/me/api-token',{method:'POST',body:JSON.stringify(scope)})).token)}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function revoke(){try{setBusy(true);await api('/admin/me/api-token',{method:'DELETE'});setToken('');setScope({productIds:[],channels:[]})}catch(e){setError(e.message)}finally{setBusy(false)}}
  return <Dialog open={open} onClose={close} fullWidth maxWidth="sm"><DialogTitle>Token CI/CD</DialogTitle><DialogContent><Stack spacing={2} mt={1}>{error&&<Alert severity="error">{error}</Alert>}<Typography variant="subtitle2">Produtos permitidos</Typography><FormGroup>{products.map(product=><FormControlLabel key={product.id} control={<Checkbox checked={scope.productIds.includes(product.id)} onChange={()=>toggle('productIds',product.id)}/>} label={product.name}/>)}</FormGroup><Typography variant="subtitle2">Ambientes permitidos</Typography><FormGroup row>{channels.map(([value,label])=><FormControlLabel key={value} control={<Checkbox checked={scope.channels.includes(value)} onChange={()=>toggle('channels',value)}/>} label={label}/>)}</FormGroup>{token&&<Alert severity="warning"><Typography variant="body2">Copie este token agora. Ele nao sera exibido novamente.</Typography><Typography sx={{wordBreak:'break-all',fontFamily:'monospace',mt:1}}>{token}</Typography><Button size="small" onClick={()=>navigator.clipboard.writeText(token)}>Copiar token</Button></Alert>}</Stack></DialogContent><DialogActions><Button onClick={close}>Fechar</Button><Button color="error" onClick={revoke} disabled={busy}>Revogar</Button><Button variant="contained" onClick={generate} disabled={busy}>{token?'Substituir token':'Gerar token'}</Button></DialogActions></Dialog>;
}
