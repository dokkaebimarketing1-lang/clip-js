import {notFound} from 'next/navigation';
import StudioConceptClient from './StudioConceptClient';

export default function StudioConceptPage() {
  if (process.env.NEXT_PUBLIC_SHOW_STUDIO_CONCEPT !== 'true') notFound();
  return <StudioConceptClient/>;
}
