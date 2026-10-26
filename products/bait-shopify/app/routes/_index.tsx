import {redirect,type LoaderFunctionArgs} from 'react-router';
export function loader({request}:LoaderFunctionArgs){const u=new URL(request.url);return redirect('/app'+u.search)}
