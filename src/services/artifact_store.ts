import { getFirestore, COLLECTIONS } from './firestore';
import { Artifact } from '../api/schemas/runtime_schemas';

export class ArtifactStore {
  static async validateIncomingArtifact(artifact: Artifact): Promise<boolean> {
    // In a real implementation, this would verify the GCS URI exists,
    // matches the MIME type, hash, and belongs to the user's allowed bucket list.
    const allowedMimeTypes = ['application/pdf', 'text/plain', 'text/markdown'];
    
    if (!allowedMimeTypes.includes(artifact.mime_type)) {
      throw new Error(`Unsupported MIME type: ${artifact.mime_type}`);
    }

    if (!artifact.uri.startsWith('gs://') && !artifact.uri.startsWith('https://')) {
      throw new Error(`Invalid URI scheme: ${artifact.uri}`);
    }
    
    // Simulating size limit check
    console.log(`[ArtifactStore] Validated incoming artifact: ${artifact.name}`);
    return true;
  }

  static async saveGeneratedArtifact(
    requestId: string,
    type: string,
    name: string,
    mimeType: string,
    content: string
  ): Promise<Artifact> {
    const db = getFirestore();
    const artifactId = `art_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    // In reality, upload `content` to GCS here.
    // For this prototype, we simulate the URI.
    const uri = `gs://aria-generated-artifacts/${requestId}/${artifactId}_${name}`;
    
    const artifact: Artifact = {
      id: artifactId,
      name,
      mime_type: mimeType,
      uri
    };

    await db.collection(COLLECTIONS.ARTIFACTS).doc(artifactId).set({
      ...artifact,
      request_id: requestId,
      created_at: new Date().toISOString(),
      simulated_content: content.substring(0, 500) // Storing a snippet for debugging in prototype
    });

    console.log(`[ArtifactStore] Saved generated artifact: ${name} (${artifactId})`);
    return artifact;
  }
}
