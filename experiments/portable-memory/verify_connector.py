"""Optional protocol smoke test. Requires the official Python mcp SDK in the test environment."""
import asyncio,base64,hashlib,importlib.util,json,re,tempfile,threading
from pathlib import Path
from urllib.parse import urlparse,parse_qs
import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

spec=importlib.util.spec_from_file_location('usual_pilot',Path(__file__).with_name('app.py'))
app=importlib.util.module_from_spec(spec);spec.loader.exec_module(app)

async def main():
    with tempfile.TemporaryDirectory() as folder:
        server,owner=app.make_server(app.MemoryStore(Path(folder)/'qa.sqlite3'))
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        origin=f'http://127.0.0.1:{server.server_port}'
        try:
            async with httpx.AsyncClient() as browser:
                metadata=(await browser.get(origin+'/.well-known/oauth-authorization-server')).json()
                assert metadata['issuer']==origin
                denied=await browser.get(origin+'/mcp')
                assert denied.status_code==401 and 'resource_metadata' in denied.headers['www-authenticate']
                registered=await browser.post(metadata['registration_endpoint'],json={'client_name':'SDK QA','redirect_uris':['http://127.0.0.1:9999/callback']})
                assert registered.status_code==201
                client_id=registered.json()['client_id']
                verifier='test-verifier-'+ 'x'*50
                challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
                params={'client_id':client_id,'redirect_uri':'http://127.0.0.1:9999/callback','response_type':'code','scope':'usual:read usual:write','resource':origin+'/mcp','code_challenge':challenge,'code_challenge_method':'S256','state':'qa'}
                consent=await browser.get(metadata['authorization_endpoint'],params=params)
                assert consent.status_code==200
                flow=re.search('name="flow" value="([^"]+)"',consent.text)[1]
                unlock=await browser.post(origin+'/api/unlock',json={},headers={'Authorization':'Bearer '+owner})
                assert unlock.status_code==200
                approval=await browser.post(origin+'/oauth/approve',data={'flow':flow,'approve':'yes'},headers={'Origin':origin})
                assert approval.status_code==303,approval.text
                code=parse_qs(urlparse(approval.headers['location']).query)['code'][0]
                exchange=await browser.post(metadata['token_endpoint'],data={'grant_type':'authorization_code','code':code,'client_id':client_id,'redirect_uri':params['redirect_uri'],'code_verifier':verifier,'resource':origin+'/mcp'})
                assert exchange.status_code==200,exchange.text
                token=exchange.json()['access_token']
            async with httpx.AsyncClient(headers={'Authorization':'Bearer '+token}) as http:
                async with streamable_http_client(origin+'/mcp',http_client=http) as (read,write,_):
                    async with ClientSession(read,write) as session:
                        result=await session.initialize()
                        assert result.serverInfo.name=='usual'
                        tools=await session.list_tools()
                        assert len(tools.tools)==3
                        evidence={'source':'Synthetic SDK test','context':'Scheduling focused writing','decision':'Keep mornings for writing','quote':'Keep mornings free for writing.','exceptions':'Except Monday meetings','basis':'explicit'}
                        saved=await session.call_tool('add_to_my_usual',{'memories':[evidence]})
                        assert not saved.isError,saved
                        recalled=await session.call_tool('use_my_usual',{'query':'writing mornings'})
                        assert not recalled.isError and recalled.structuredContent['memories'][0]['exceptions']=='Except Monday meetings'
                        memory_id=recalled.structuredContent['memories'][0]['id']
                        excluded=await session.call_tool('exclude_from_my_usual',{'ids':[memory_id]})
                        assert not excluded.isError
                        again=await session.call_tool('use_my_usual',{'query':''})
                        assert again.structuredContent['memories']==[]
            print('PASS: HTTP OAuth discovery, DCR, browser consent, PKCE exchange, standard MCP SDK initialize/list/save/recall/exclude. Temporary synthetic collection only.')
        finally:
            server.shutdown();server.server_close();thread.join()

asyncio.run(main())
