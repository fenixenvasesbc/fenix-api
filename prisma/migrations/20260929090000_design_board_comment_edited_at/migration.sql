-- Permite editar/eliminar comentarios propios y eliminar adjuntos del
-- tablero de bocetos. editedAt se completa cuando el autor edita un
-- comentario despues de creado (la UI muestra "editado" en base a esto);
-- el borrado de comentarios/adjuntos es fisico (DELETE), sin columna
-- nueva para eso.
ALTER TABLE "DesignRequestComment" ADD COLUMN "editedAt" TIMESTAMP(3);
