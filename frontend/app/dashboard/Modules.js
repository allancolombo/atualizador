'use client';
import {useEffect,useMemo,useState} from 'react';
import {Alert,Box,Button,Checkbox,Chip,Dialog,DialogActions,DialogContent,DialogTitle,Divider,FormControl,FormControlLabel,IconButton,InputLabel,MenuItem,Select,Stack,Switch,Tab,Table,TableBody,TableCell,TableHead,TableRow,Tabs,TextField,Tooltip,Typography} from '@mui/material';
import {Add as AddIcon,Edit as EditIcon,Refresh as RefreshIcon} from '@mui/icons-material';
import {api} from '../../lib/api';

const fmt=value=>value?new Date(value.includes('T')?value:value.replace(' ','T')+'Z').toLocaleString('pt-BR'):'-';
const formatDocument=value=>{const d=String(value||'');return d.length===14?d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5'):d.length===11?d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/,'$1.$2.$3-$4'):d};
const statusChip={beta:{label:'beta',color:'info'},reservado:{label:'reservado',color:'default'}};
const eventLabel={company_seen:'Empresa apareceu na consulta',company_created:'Empresa cadastrada no painel',client_changed:'CNPJ chegou por outro cliente',plan_assigned:'Plano alterado',plan_changed:'Conteúdo do plano alterado',module_changed:'Módulo alterado',enforce_on:'Bloqueio real ligado',enforce_off:'Bloqueio real desligado'};

function groupCatalog(catalog){const groups=new Map;for(const item of catalog){if(!groups.has(item.group))groups.set(item.group,[]);groups.get(item.group).push(item)}return[...groups]}
const nameOf=(catalog,key)=>catalog.find(item=>item.key===key)?.name||key;

export default function Modules({admin}){
  const[tab,setTab]=useState('companies'),[catalog,setCatalog]=useState([]),[plans,setPlans]=useState([]),[companies,setCompanies]=useState([]),[search,setSearch]=useState(''),[company,setCompany]=useState(null),[plan,setPlan]=useState(null),[creating,setCreating]=useState(false),[message,setMessage]=useState(null);
  async function load(){try{const[c,p,list]=await Promise.all([api('/admin/modules/catalog'),api('/admin/modules/plans'),api(`/admin/modules/companies${search?`?search=${encodeURIComponent(search)}`:''}`)]);setCatalog(c);setPlans(p);setCompanies(list)}catch(e){setMessage({severity:'error',text:e.message})}}
  useEffect(()=>{load()},[]);
  return <Stack spacing={2}>
    {message&&<Alert severity={message.severity} onClose={()=>setMessage(null)}>{message.text}</Alert>}
    <Alert severity="info">A licença vai para o servidor do cliente junto com a consulta de versão. Enquanto o servidor não aplicar os módulos, nada é bloqueado na loja. O bloqueio real só vale para empresas com "Bloqueio real" ligado.</Alert>
    <Tabs value={tab} onChange={(_,value)=>setTab(value)}><Tab value="companies" label="Empresas"/><Tab value="plans" label="Planos"/><Tab value="crm" label="Grupos do CRM"/></Tabs>
    {tab==='crm'&&<CrmGroups catalog={catalog} plans={plans} admin={admin}/>}
    {tab==='companies'&&<>
      <Stack direction={{xs:'column',md:'row'}} spacing={1}>
        <TextField size="small" label="Buscar por CNPJ, empresa ou cliente" value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>e.key==='Enter'&&load()} sx={{minWidth:320}}/>
        <Button startIcon={<RefreshIcon/>} onClick={load}>Buscar</Button>
        <Box flex={1}/>
        {admin&&<Button variant="contained" startIcon={<AddIcon/>} onClick={()=>setCreating(true)}>Cadastrar CNPJ</Button>}
      </Stack>
      <Box sx={{overflowX:'auto'}}><Table size="small"><TableHead><TableRow><TableCell>CNPJ/CPF</TableCell><TableCell>Empresa</TableCell><TableCell>Cliente</TableCell><TableCell>Plano</TableCell><TableCell>Exceções</TableCell><TableCell>Bloqueio real</TableCell><TableCell>Último contato</TableCell><TableCell/></TableRow></TableHead><TableBody>
        {companies.map(c=><TableRow key={c.id} hover>
          <TableCell>{formatDocument(c.document)}</TableCell><TableCell>{c.name||'-'}</TableCell><TableCell>{c.client_name||'-'}</TableCell>
          <TableCell>{c.plan_name?<Chip size="small" label={c.plan_name}/>:c.crm_plan_name?<Chip size="small" variant="outlined" label={`${c.crm_plan_name} (CRM)`}/>:<Chip size="small" color="warning" label="Sem plano"/>}</TableCell>
          <TableCell>{c.override_count||'-'}</TableCell><TableCell>{c.enforce?<Chip size="small" color="error" label="Ligado"/>:'Observação'}</TableCell>
          <TableCell>{fmt(c.last_seen_at)}</TableCell>
          <TableCell><Tooltip title="Ver módulos"><IconButton onClick={()=>setCompany(c.id)}><EditIcon/></IconButton></Tooltip></TableCell>
        </TableRow>)}
        {!companies.length&&<TableRow><TableCell colSpan={8}><Typography color="text.secondary">Nenhuma empresa ainda. Elas aparecem quando o servidor do cliente consulta a versão, ou podem ser cadastradas antes.</Typography></TableCell></TableRow>}
      </TableBody></Table></Box>
    </>}
    {tab==='plans'&&<>
      <Stack direction="row"><Box flex={1}/>{admin&&<Button variant="contained" startIcon={<AddIcon/>} onClick={()=>setPlan({})}>Novo plano</Button>}</Stack>
      <Box sx={{overflowX:'auto'}}><Table size="small"><TableHead><TableRow><TableCell>Plano</TableCell><TableCell>Código</TableCell><TableCell>Módulos</TableCell><TableCell>Empresas</TableCell><TableCell>Situação</TableCell><TableCell/></TableRow></TableHead><TableBody>
        {plans.map(p=><TableRow key={p.id} hover><TableCell>{p.name}</TableCell><TableCell>{p.code}</TableCell><TableCell>{p.modules.filter(m=>m.mode!=='available').length} inclusos · {p.modules.filter(m=>m.mode==='available').length} adicionais</TableCell><TableCell>{p.company_count}</TableCell><TableCell>{p.active?'Ativo':'Inativo'}</TableCell><TableCell><Tooltip title={admin?'Editar plano':'Ver plano'}><IconButton onClick={()=>setPlan(p)}><EditIcon/></IconButton></Tooltip></TableCell></TableRow>)}
      </TableBody></Table></Box>
    </>}
    <CompanyDialog id={company} catalog={catalog} plans={plans} admin={admin} close={()=>{setCompany(null);load()}}/>
    <PlanDialog value={plan} catalog={catalog} admin={admin} close={()=>setPlan(null)} done={text=>{setPlan(null);setMessage({severity:'success',text});load()}}/>
    <NewCompanyDialog open={creating} plans={plans} close={()=>setCreating(false)} done={id=>{setCreating(false);load();setCompany(id)}}/>
  </Stack>;
}

function NewCompanyDialog({open,plans,close,done}){
  const[form,setForm]=useState({document:'',name:'',planId:''}),[error,setError]=useState('');
  useEffect(()=>{if(open){setForm({document:'',name:'',planId:''});setError('')}},[open]);
  async function save(){try{const view=await api('/admin/modules/companies',{method:'POST',body:JSON.stringify({...form,planId:form.planId||null})});done(view.company.id)}catch(e){setError(e.message)}}
  return <Dialog open={open} onClose={close} fullWidth maxWidth="sm"><DialogTitle>Cadastrar CNPJ</DialogTitle><DialogContent><Stack spacing={2} mt={1}>
    {error&&<Alert severity="error">{error}</Alert>}
    <TextField label="CNPJ ou CPF" value={form.document} onChange={e=>setForm({...form,document:e.target.value})}/>
    <TextField label="Nome" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/>
    <FormControl><InputLabel shrink>Plano</InputLabel><Select label="Plano" notched displayEmpty value={form.planId} onChange={e=>setForm({...form,planId:e.target.value})}><MenuItem value="">Sem plano</MenuItem>{plans.filter(p=>p.active).map(p=><MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}</Select></FormControl>
  </Stack></DialogContent><DialogActions><Button onClick={close}>Cancelar</Button><Button variant="contained" onClick={save}>Cadastrar</Button></DialogActions></Dialog>;
}

function moduleState(view,item){
  const on=view.resolved[item.key],origin=view.origin[item.key],override=view.overrides.find(o=>o.key===item.key);
  if(on)return{label:{override:'Ligado à mão',crm:'Ligado pelo CRM',crm_plan:'Ligado pelo plano do CRM'}[origin]||'Ligado pelo plano',color:view.outsidePlan?.includes(item.key)?'warning':'success'};
  if(view.blocked.includes(item.key))return{label:`Falta ${item.depends.filter(dep=>!view.resolved[dep]).join(', ')}`,color:'warning'};
  if(override&&!override.enabled)return{label:'Desligado à mão',color:'error'};
  if(override?.expired)return{label:'Exceção vencida',color:'default'};
  return{label:'Desligado',color:'default'};
}

function CompanyDialog({id,catalog,plans,admin,close}){
  const[view,setView]=useState(null),[notice,setNotice]=useState(null),[busy,setBusy]=useState(false),[drafts,setDrafts]=useState({});
  async function load(){try{setView(await api(`/admin/modules/companies/${id}`))}catch(e){setNotice({severity:'error',text:e.message})}}
  useEffect(()=>{setView(null);setNotice(null);setDrafts({});if(id)load()},[id]);
  async function patch(body){setBusy(true);try{setView(await api(`/admin/modules/companies/${id}`,{method:'PATCH',body:JSON.stringify(body)}));setNotice({severity:'success',text:'Empresa atualizada.'})}catch(e){setNotice({severity:'error',text:e.message})}finally{setBusy(false)}}
  async function setModule(item,enabled,extra={}){setBusy(true);try{const result=await api(`/admin/modules/companies/${id}/modules/${encodeURIComponent(item.key)}`,{method:'PUT',body:JSON.stringify({enabled,...extra})});setView(result);const parts=[];if(result.autoEnabled?.length)parts.push(`Também ligados, por dependência: ${result.autoEnabled.map(k=>nameOf(catalog,k)).join(', ')}.`);if(result.autoDisabled?.length)parts.push(`Também desligados, porque dependem dele: ${result.autoDisabled.map(k=>nameOf(catalog,k)).join(', ')}.`);setNotice({severity:parts.length?'warning':'success',text:parts.join(' ')||`${item.name}: alterado.`})}catch(e){setNotice({severity:'error',text:e.message})}finally{setBusy(false)}}
  const groups=useMemo(()=>groupCatalog(catalog),[catalog]);
  const c=view?.company;
  return <Dialog open={!!id} onClose={close} fullWidth maxWidth="lg"><DialogTitle>Módulos de {c?.name||formatDocument(c?.document)}</DialogTitle><DialogContent dividers>{view&&<Stack spacing={2}>
    {notice&&<Alert severity={notice.severity} onClose={()=>setNotice(null)}>{notice.text}</Alert>}
    <Stack direction={{xs:'column',md:'row'}} spacing={2} alignItems={{md:'center'}}>
      <Typography>CNPJ/CPF: <b>{formatDocument(c.document)}</b></Typography>
      <Typography>Cliente: <b>{c.client_name||'-'}</b>{c.terminal_name?` (${c.terminal_name})`:''}</Typography>
      <Typography>Último contato: <b>{fmt(c.last_seen_at)}</b></Typography>
    </Stack>
    <Stack direction={{xs:'column',md:'row'}} spacing={2} alignItems={{md:'center'}}>
      <FormControl size="small" sx={{minWidth:240}} disabled={!admin||busy}><InputLabel shrink>Plano manual</InputLabel><Select label="Plano manual" notched displayEmpty value={c.plan_id||''} onChange={e=>patch({planId:e.target.value||null})}><MenuItem value="">{c.crm_customer_id?'Seguir o CRM':'Sem plano'}</MenuItem>{plans.map(p=><MenuItem key={p.id} value={p.id} disabled={!p.active}>{p.name}{p.active?'':' (inativo)'}</MenuItem>)}</Select></FormControl>
      <FormControlLabel disabled={!admin||busy} control={<Switch checked={!!c.enforce} onChange={e=>patch({enforce:e.target.checked})}/>} label="Bloqueio real (desligado = só observação)"/>
    </Stack>
    {c.crm_customer_id?<Alert severity="info" icon={false}>
      <Typography variant="body2"><b>CRM:</b> cliente {c.crm_customer_id}{c.crm_user_code?` · código GooPedir ${c.crm_user_code}`:''}{c.crm_active===0?' · inativo no Perfex':''} · sincronizado em {fmt(c.crm_synced_at)}</Typography>
      <Typography variant="body2">Plano em uso: <b>{plans.find(p=>p.code===view.plan)?.name||'nenhum'}</b>{view.plan&&` (${view.planSource==='manual'?'escolhido aqui, vale mais que o CRM':'vindo do CRM'})`}</Typography>
      <Stack direction="row" spacing={.5} flexWrap="wrap" useFlexGap mt={.5}>{view.crmGroups.map(g=><Chip key={g.id} size="small" variant="outlined" color={g.kind==='ignore'?'default':'primary'} label={`${g.name}${g.kind==='ignore'?' (sem mapeamento)':''}`}/>)}{!view.crmGroups.length&&<Typography variant="body2" color="text.secondary">Sem grupos no Perfex.</Typography>}</Stack>
      {c.crm_data&&<Typography variant="caption" display="block" mt={.5}>{[c.crm_data.phone,c.crm_data.email,[c.crm_data.address,c.crm_data.number].filter(Boolean).join(', '),c.crm_data.district,[c.crm_data.city,c.crm_data.state].filter(Boolean).join('/')].filter(Boolean).join(' · ')}</Typography>}
    </Alert>:<Typography variant="body2" color="text.secondary">Sem vínculo com o CRM.</Typography>}
    {view.outsidePlan?.length>0&&<Alert severity="warning">Ligado fora do que o plano permite contratar: {view.outsidePlan.map(k=>nameOf(catalog,k)).join(', ')}. Não bloqueia, só avisa.</Alert>}
    <Divider/>
    {groups.map(([group,items])=><Box key={group} sx={{overflowX:'auto'}}><Typography variant="subtitle2" color="text.secondary" mb={.5}>{group}</Typography><Table size="small" sx={{minWidth:720}}><TableBody>{items.map(item=>{
      const override=view.overrides.find(o=>o.key===item.key),state=moduleState(view,item),choice=override?(override.enabled?'on':'off'):'inherit',draft=drafts[item.key]||{limits:override?.limits||{},validUntil:override?.validUntil?.slice(0,10)||''};
      const setDraft=next=>setDrafts(current=>({...current,[item.key]:{...draft,...next}}));
      const saveOn=()=>setModule(item,true,{limits:draft.limits,validUntil:draft.validUntil?`${draft.validUntil}T23:59:59`:null});
      return <TableRow key={item.key}>
        <TableCell sx={{width:'32%'}}>{item.name} {statusChip[item.status]&&<Chip size="small" variant="outlined" {...statusChip[item.status]}/>}<Typography variant="caption" display="block" color="text.secondary">{item.key}{item.depends.length?` · precisa de ${item.depends.join(', ')}`:''}</Typography></TableCell>
        <TableCell sx={{width:'20%'}}><Chip size="small" color={state.color} label={state.label}/>{view.resolved[item.key]?.limits&&<Typography variant="caption" display="block">{Object.entries(view.resolved[item.key].limits).map(([k,v])=>`${k}: ${v}`).join(', ')}</Typography>}</TableCell>
        <TableCell sx={{width:'18%'}}><Select size="small" fullWidth disabled={!admin||busy||item.status==='reservado'} value={choice} onChange={e=>e.target.value==='on'?saveOn():setModule(item,e.target.value==='off'?false:null)}><MenuItem value="inherit">Seguir o plano</MenuItem><MenuItem value="on">Ligar</MenuItem><MenuItem value="off">Desligar</MenuItem></Select></TableCell>
        <TableCell>{choice==='on'&&admin&&<Stack direction="row" spacing={1} alignItems="center">
          {item.limitKeys.map(k=><TextField key={k} size="small" type="number" label={k} sx={{width:120}} value={draft.limits?.[k]??''} onChange={e=>setDraft({limits:{...draft.limits,[k]:e.target.value}})}/>)}
          <TextField size="small" type="date" label="Válido até" InputLabelProps={{shrink:true}} value={draft.validUntil} onChange={e=>setDraft({validUntil:e.target.value})}/>
          <Button size="small" disabled={busy} onClick={saveOn}>Salvar</Button>
        </Stack>}{choice==='on'&&!admin&&override?.validUntil&&<Typography variant="caption">Até {fmt(override.validUntil)}</Typography>}</TableCell>
      </TableRow>})}</TableBody></Table></Box>)}
    <Divider/>
    <Typography variant="subtitle2">Histórico</Typography>
    <Table size="small"><TableBody>{view.events.map(e=><TableRow key={e.id}><TableCell sx={{width:180}}>{fmt(e.createdAt)}</TableCell><TableCell>{eventLabel[e.action]||e.action}{e.action==='module_changed'&&e.details?`: ${nameOf(catalog,e.details.key)} → ${e.details.enabled===null?'seguir o plano':e.details.enabled?'ligado':'desligado'}`:''}</TableCell><TableCell>{e.userName||'Sistema'}</TableCell></TableRow>)}{!view.events.length&&<TableRow><TableCell>Sem alterações.</TableCell></TableRow>}</TableBody></Table>
  </Stack>}</DialogContent><DialogActions><Button onClick={close}>Fechar</Button></DialogActions></Dialog>;
}

function PlanDialog({value,catalog,admin,close,done}){
  const[form,setForm]=useState(null),[error,setError]=useState('');
  useEffect(()=>{if(value){setError('');setForm({code:value.code||'',name:value.name||'',active:value.active!==false,modules:Object.fromEntries((value.modules||[]).map(m=>[m.key,{mode:m.mode||'included',limits:m.limits||{}}]))})}},[value]);
  const groups=useMemo(()=>groupCatalog(catalog),[catalog]);
  if(!form)return null;
  // Incluído puxa as dependências como incluídas; tirar um módulo tira o que depende dele.
  const setMode=(item,mode)=>{const modules={...form.modules};if(mode==='none'){delete modules[item.key];for(const other of catalog)if(other.depends.includes(item.key))delete modules[other.key]}else{modules[item.key]={mode,limits:modules[item.key]?.limits||{}};for(const dep of item.depends){const current=modules[dep];if(!current)modules[dep]={mode,limits:{}};else if(mode==='included'&&current.mode==='available')modules[dep]={...current,mode:'included'}}}setForm({...form,modules})};
  async function save(){try{const body={code:form.code,name:form.name,active:form.active,modules:Object.entries(form.modules).map(([key,value])=>({key,mode:value.mode,limits:value.limits}))};const result=await api(value.id?`/admin/modules/plans/${value.id}`:'/admin/modules/plans',{method:value.id?'PUT':'POST',body:JSON.stringify(body)});done(result.addedDependencies?.length?`Plano salvo. Dependências ajustadas: ${result.addedDependencies.join(', ')}.`:'Plano salvo.')}catch(e){setError(e.message)}}
  return <Dialog open={!!value} onClose={close} fullWidth maxWidth="md"><DialogTitle>{value.id?`Plano ${value.name}`:'Novo plano'}</DialogTitle><DialogContent dividers><Stack spacing={2}>
    {error&&<Alert severity="error">{error}</Alert>}
    {value.company_count>0&&<Alert severity="warning">Este plano está em {value.company_count} empresa(s) escolhidas no painel. A mudança vale para elas e para quem recebe o plano pelo CRM, na próxima consulta.</Alert>}
    <Stack direction={{xs:'column',md:'row'}} spacing={2}>
      <TextField label="Código" value={form.code} disabled={!!value.id||!admin} onChange={e=>setForm({...form,code:e.target.value})} helperText="Letras minúsculas, números, - e _"/>
      <TextField label="Nome" value={form.name} disabled={!admin} onChange={e=>setForm({...form,name:e.target.value})} sx={{flex:1}}/>
      <FormControlLabel disabled={!admin} control={<Switch checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/>} label="Ativo"/>
    </Stack>
    <Typography variant="body2" color="text.secondary"><b>Incluso</b> vem no preço do plano. <b>Adicional</b> pode ser contratado à parte por quem tem este plano.</Typography>
    {groups.map(([group,items])=><Box key={group}><Typography variant="subtitle2" color="text.secondary">{group}</Typography>{items.map(item=>{const current=form.modules[item.key];return <Stack key={item.key} direction={{xs:'column',sm:'row'}} alignItems={{sm:'center'}} spacing={1} py={.5}>
      <Box flex={1}>{item.name} {statusChip[item.status]&&<Chip size="small" variant="outlined" {...statusChip[item.status]}/>}<Typography variant="caption" display="block" color="text.secondary">{item.key}</Typography></Box>
      {current?.mode==='included'&&item.limitKeys.map(k=><TextField key={k} size="small" type="number" label={`${k} (vazio = ilimitado)`} sx={{width:190}} disabled={!admin} value={current.limits?.[k]??''} onChange={e=>setForm({...form,modules:{...form.modules,[item.key]:{...current,limits:{...current.limits,[k]:e.target.value}}}})}/>)}
      <Select size="small" sx={{width:150}} disabled={!admin||item.status==='reservado'} value={current?.mode||'none'} onChange={e=>setMode(item,e.target.value)}><MenuItem value="none">Não oferece</MenuItem><MenuItem value="included">Incluso</MenuItem><MenuItem value="available">Adicional</MenuItem></Select>
    </Stack>})}</Box>)}
  </Stack></DialogContent><DialogActions><Button onClick={close}>{admin?'Cancelar':'Fechar'}</Button>{admin&&<Button variant="contained" onClick={save}>Salvar</Button>}</DialogActions></Dialog>;
}

const kindLabel={plan:'Plano',module:'Módulos',ignore:'Ignorar'};
function CrmGroups({catalog,plans,admin}){
  const[data,setData]=useState(null),[editing,setEditing]=useState(null),[message,setMessage]=useState(null);
  async function load(){try{setData(await api('/admin/modules/crm'))}catch(e){setMessage({severity:'error',text:e.message})}}
  useEffect(()=>{load()},[]);
  if(!data)return null;
  const run=data.lastRun;
  return <Stack spacing={2}>
    {message&&<Alert severity={message.severity} onClose={()=>setMessage(null)}>{message.text}</Alert>}
    {!data.configured&&<Alert severity="warning">A sincronização está desligada: falta configurar CRM_SYNC_TOKEN na central.</Alert>}
    <Typography variant="body2" color="text.secondary">{run?<>Última sincronização: <b>{fmt(run.received_at)}</b> · {run.customers} clientes, {run.created} novos, {run.changed} alterados, {run.removed} removidos{run.skipped.length?`, ${run.skipped.length} ignorados (${run.skipped.map(s=>`${s.name||s.id}: ${s.reason==='sem_cnpj'?'sem CNPJ':s.reason==='cnpj_repetido'?'CNPJ repetido':s.reason}`).join('; ')})`:''}</>:'Nenhuma sincronização recebida ainda. A API envia os clientes do Perfex a cada 5 minutos.'}</Typography>
    <Box sx={{overflowX:'auto'}}><Table size="small"><TableHead><TableRow><TableCell>Id</TableCell><TableCell>Grupo no Perfex</TableCell><TableCell>Tipo</TableCell><TableCell>Libera</TableCell><TableCell>Empresas</TableCell><TableCell/></TableRow></TableHead><TableBody>
      {data.groups.map(g=><TableRow key={g.id} hover sx={{opacity:g.present?1:.5}}>
        <TableCell>{g.id}</TableCell><TableCell>{g.name}{!g.present&&' (removido do Perfex)'}</TableCell>
        <TableCell><Chip size="small" color={g.kind==='ignore'?'default':'primary'} variant={g.kind==='plan'?'filled':'outlined'} label={kindLabel[g.kind]}/></TableCell>
        <TableCell>{g.kind==='plan'?g.planName:g.kind==='module'?g.modules.map(k=>`${nameOf(catalog,k)}${g.unlimited.includes(k)?' (ilimitado)':''}`).join(', '):'-'}</TableCell>
        <TableCell>{g.companyCount}</TableCell>
        <TableCell>{admin&&<Tooltip title="Mapear grupo"><IconButton onClick={()=>setEditing(g)}><EditIcon/></IconButton></Tooltip>}</TableCell>
      </TableRow>)}
      {!data.groups.length&&<TableRow><TableCell colSpan={6}><Typography color="text.secondary">Os grupos aparecem aqui na primeira sincronização.</Typography></TableCell></TableRow>}
    </TableBody></Table></Box>
    <CrmGroupDialog value={editing} catalog={catalog} plans={plans} close={()=>setEditing(null)} done={()=>{setEditing(null);setMessage({severity:'success',text:'Grupo mapeado. Vale na próxima consulta de cada servidor.'});load()}}/>
  </Stack>;
}

function CrmGroupDialog({value,catalog,plans,close,done}){
  const[form,setForm]=useState(null),[error,setError]=useState('');
  useEffect(()=>{if(value){setError('');setForm({kind:value.kind,planId:value.planId||'',priority:value.priority||0,modules:value.modules||[],unlimited:value.unlimited||[]})}},[value]);
  const groups=useMemo(()=>groupCatalog(catalog),[catalog]);
  if(!form)return null;
  const toggle=(key,checked)=>setForm({...form,modules:checked?[...form.modules,key]:form.modules.filter(k=>k!==key),unlimited:checked?form.unlimited:form.unlimited.filter(k=>k!==key)});
  async function save(){try{await api(`/admin/modules/crm/groups/${value.id}`,{method:'PUT',body:JSON.stringify(form)});done()}catch(e){setError(e.message)}}
  return <Dialog open={!!value} onClose={close} fullWidth maxWidth="md"><DialogTitle>Grupo {value.name}</DialogTitle><DialogContent dividers><Stack spacing={2}>
    {error&&<Alert severity="error">{error}</Alert>}
    <Stack direction={{xs:'column',md:'row'}} spacing={2}>
      <FormControl size="small" sx={{minWidth:180}}><InputLabel>Tipo</InputLabel><Select label="Tipo" value={form.kind} onChange={e=>setForm({...form,kind:e.target.value})}><MenuItem value="plan">Plano</MenuItem><MenuItem value="module">Módulos</MenuItem><MenuItem value="ignore">Ignorar</MenuItem></Select></FormControl>
      {form.kind==='plan'&&<><FormControl size="small" sx={{minWidth:200}}><InputLabel>Plano</InputLabel><Select label="Plano" value={form.planId} onChange={e=>setForm({...form,planId:e.target.value})}>{plans.map(p=><MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}</Select></FormControl>
      <TextField size="small" type="number" label="Prioridade" value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})} helperText="Com dois grupos de plano, vale o de maior prioridade"/></>}
    </Stack>
    {form.kind==='module'&&groups.map(([group,items])=><Box key={group}><Typography variant="subtitle2" color="text.secondary">{group}</Typography><Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',md:'1fr 1fr'}}}>{items.filter(item=>item.status!=='reservado').map(item=><Stack key={item.key} direction="row" alignItems="center">
      <FormControlLabel control={<Checkbox checked={form.modules.includes(item.key)} onChange={e=>toggle(item.key,e.target.checked)}/>} label={item.name}/>
      {form.modules.includes(item.key)&&item.limitKeys.length>0&&<FormControlLabel control={<Switch size="small" checked={form.unlimited.includes(item.key)} onChange={e=>setForm({...form,unlimited:e.target.checked?[...form.unlimited,item.key]:form.unlimited.filter(k=>k!==item.key)})}/>} label="ilimitado"/>}
    </Stack>)}</Box></Box>)}
  </Stack></DialogContent><DialogActions><Button onClick={close}>Cancelar</Button><Button variant="contained" onClick={save}>Salvar</Button></DialogActions></Dialog>;
}
